import { MessageFlags, type ButtonInteraction, type Interaction } from 'discord.js';
import { commandMap } from '../commands/index.js';
import { checkDj } from '../commands/helpers.js';
import type { Context } from '../commands/types.js';
import type { Config } from '../config.js';
import type { SettingsStore } from '../db/settings.js';
import { t } from '../i18n/index.js';
import type { PlayerManager } from '../player/manager.js';
import type { LoopMode } from '../player/queue.js';
import { log } from '../util/logger.js';
import { RateLimiter } from '../util/rateLimit.js';
import { redirectChannel } from './channelGate.js';
import { isGuildAllowed } from './guildAllowlist.js';
import { BUTTON_IDS } from './ui.js';

export interface Services {
  manager: PlayerManager;
  settings: SettingsStore;
  config: Config;
}

/** Commands that start yt-dlp or external lookups: per member and per server limits. */
export const memberLimiter = new RateLimiter(5, 30_000);
export const guildLimiter = new RateLimiter(30, 60_000);

/** Returns the ms to wait when a heavy command is over its limit, else 0 (and counts the hit). */
export function heavyCommandWait(guildId: string, userId: string, member = memberLimiter, guild = guildLimiter): number {
  const wait = member.take(`${guildId}:${userId}`);
  return wait || guild.take(guildId);
}

const NEXT_LOOP: Record<LoopMode, LoopMode> = { off: 'queue', queue: 'track', track: 'off' };

async function handleButton(i: ButtonInteraction<'cached'>, s: Services): Promise<void> {
  const locale = s.settings.get(i.guildId).locale;
  const player = s.manager.get(i.guildId);
  const ephemeral = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  if (!player?.queue.current) return void (await ephemeral(t(locale, 'error.nothingPlaying')));
  if (i.member.voice.channelId !== player.channelId) {
    return void (await ephemeral(t(locale, 'error.notSameVoice', { channel: `<#${player.channelId}>` })));
  }
  const { djRoleId } = s.settings.get(i.guildId);
  if (djRoleId && !i.member.roles.cache.has(djRoleId) && !i.member.permissions.has('ManageGuild')) {
    return void (await ephemeral(t(locale, 'error.djOnly', { role: `<@&${djRoleId}>` })));
  }
  switch (i.customId) {
    case BUTTON_IDS.pause:
      if (player.isPaused) player.resume();
      else player.pause();
      await i.deferUpdate();
      await player.refreshControls();
      return;
    case BUTTON_IDS.skip:
      await i.deferUpdate();
      player.skip();
      return;
    case BUTTON_IDS.stop:
      await i.deferUpdate();
      await player.stop();
      return;
    case BUTTON_IDS.loop:
      player.queue.loop = NEXT_LOOP[player.queue.loop];
      await i.deferUpdate();
      await player.refreshControls();
      return;
  }
}

export async function handleInteraction(interaction: Interaction, s: Services): Promise<void> {
  if (!interaction.inCachedGuild()) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: t(s.config.defaultLocale, 'error.guildOnly'), flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (!isGuildAllowed(s.config.allowedGuildIds, interaction.guildId)) {
    log.warn(`[${interaction.guildId}] interaction from a server that is not allowed (user ${interaction.user.id}), rejected`);
    if (interaction.isAutocomplete()) await interaction.respond([]).catch(() => undefined);
    else if (interaction.isRepliable()) {
      await interaction
        .reply({ content: t(s.config.defaultLocale, 'error.guildNotAllowed'), flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    }
    return;
  }
  if (interaction.isAutocomplete()) {
    const cmd = commandMap.get(interaction.commandName);
    await cmd?.autocomplete?.(interaction).catch(() => undefined);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('rk:') && Object.values(BUTTON_IDS).includes(interaction.customId as never)) {
    const { musicChannelId, locale } = s.settings.get(interaction.guildId);
    const redirect = redirectChannel(musicChannelId, 'button', interaction.channelId);
    log.info(`[${interaction.guildId}] button ${interaction.customId} by ${interaction.user.id} in #${interaction.channelId}${redirect ? ` -> redirected to #${redirect}` : ''}`);
    if (redirect) {
      await interaction
        .reply({ content: t(locale, 'error.useMusicChannel', { channel: `<#${redirect}>` }), flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
      return;
    }
    await handleButton(interaction, s).catch((e: unknown) => log.warn('button failed:', (e as Error).message));
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;
  const guildSettings = s.settings.get(interaction.guildId);
  const ctx: Context = { interaction, ...s, locale: guildSettings.locale };
  const redirect = redirectChannel(guildSettings.musicChannelId, interaction.commandName, interaction.channelId);
  log.info(
    `[${interaction.guildId}] /${interaction.commandName} by ${interaction.user.id} in #${interaction.channelId}` +
      (redirect ? ` -> redirected to #${redirect}` : ''),
  );
  if (redirect) {
    await interaction
      .reply({ content: t(ctx.locale, 'error.useMusicChannel', { channel: `<#${redirect}>` }), flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
    return;
  }
  if (cmd.heavy) {
    const wait = heavyCommandWait(interaction.guildId, interaction.user.id);
    if (wait > 0) {
      log.info(`[${interaction.guildId}] rate limited /${interaction.commandName} by ${interaction.user.id}`);
      await interaction
        .reply({ content: `⏳ ${t(ctx.locale, 'error.rateLimited', { seconds: Math.ceil(wait / 1000) })}`, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
      return;
    }
  }
  try {
    if (cmd.dj && !(await checkDj(ctx))) return;
    await cmd.execute(ctx);
  } catch (e) {
    log.error(`/${interaction.commandName} failed:`, e);
    const content = `❌ ${t(ctx.locale, 'error.generic')}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] }).catch(() => undefined);
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}
