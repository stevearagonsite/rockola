import { describe, expect, it, vi } from 'vitest';
import { commands } from '../src/commands/index.js';
import { loadConfig, type Config } from '../src/config.js';
import { isGuildAllowed } from '../src/discord/guildAllowlist.js';
import { handleInteraction, type Services } from '../src/discord/interactions.js';
import { SettingsStore } from '../src/db/settings.js';
import type { PlayerManager } from '../src/player/manager.js';

const SA = '476195750246875136';
const EDWORK = '1506003930436604037';

describe('isGuildAllowed', () => {
  it('only allows listed servers', () => {
    expect(isGuildAllowed([SA, EDWORK], SA)).toBe(true);
    expect(isGuildAllowed([SA, EDWORK], EDWORK)).toBe(true);
    expect(isGuildAllowed([SA, EDWORK], '999999999999999999')).toBe(false);
    expect(isGuildAllowed([SA], null)).toBe(false);
  });
  it('an empty list means no restriction', () => {
    expect(isGuildAllowed([], '999999999999999999')).toBe(true);
  });
});

describe('ALLOWED_GUILD_IDS config', () => {
  function withEnv(env: Record<string, string | undefined>, fn: () => void) {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      fn();
    } finally {
      process.env = saved;
    }
  }
  it('defaults to DISCORD_GUILD_IDS', () => {
    withEnv({ DISCORD_GUILD_IDS: `${SA},${EDWORK}`, DISCORD_GUILD_ID: undefined, ALLOWED_GUILD_IDS: undefined }, () => {
      expect(loadConfig(false).allowedGuildIds).toEqual([SA, EDWORK]);
    });
  });
  it('can be set on its own', () => {
    withEnv({ DISCORD_GUILD_IDS: SA, ALLOWED_GUILD_IDS: `${SA} ${EDWORK}` }, () => {
      expect(loadConfig(false).allowedGuildIds).toEqual([SA, EDWORK]);
    });
  });
});

describe('command registration', () => {
  it('every command is guild-install only and usable only in servers', () => {
    for (const c of commands) {
      expect(c.data.integration_types, c.data.name).toEqual([0]); // GuildInstall
      expect(c.data.contexts, c.data.name).toEqual([0]); // Guild
    }
  });
});

describe('interactions from other servers', () => {
  function services(): Services {
    return {
      manager: { get: () => undefined } as unknown as PlayerManager,
      settings: new SettingsStore(':memory:', 'en'),
      config: { allowedGuildIds: [SA, EDWORK], defaultLocale: 'en' } as Config,
    };
  }
  function fakeCommand(guildId: string | null) {
    return {
      guildId,
      user: { id: '1' },
      commandName: 'play',
      inCachedGuild: () => guildId !== null,
      isRepliable: () => true,
      isAutocomplete: () => false,
      isButton: () => false,
      isChatInputCommand: () => true,
      reply: vi.fn(async () => undefined),
    };
  }

  it('rejects them ephemerally without running the command', async () => {
    const i = fakeCommand('999999999999999999');
    await handleInteraction(i as never, services());
    expect(i.reply).toHaveBeenCalledWith({ content: 'Rockola is private and not enabled in this server.', flags: 64 });
  });

  it('rejects DMs and user installs outside a server', async () => {
    const i = fakeCommand(null);
    await handleInteraction(i as never, services());
    expect(i.reply).toHaveBeenCalledWith({ content: 'This command only works in servers.', flags: 64 });
  });

  it('lets allowed servers through', async () => {
    const i = { ...fakeCommand(SA), isChatInputCommand: () => false };
    await handleInteraction(i as never, services());
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('autocomplete from other servers gets no suggestions', async () => {
    const respond = vi.fn(async () => undefined);
    const i = { ...fakeCommand('999999999999999999'), isAutocomplete: () => true, respond };
    await handleInteraction(i as never, services());
    expect(respond).toHaveBeenCalledWith([]);
  });
});
