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
import { BUTTON_IDS } from './ui.js';

export interface Services {
  manager: PlayerManager;
  settings: SettingsStore;
  config: Config;
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
  if (interaction.isAutocomplete()) {
    const cmd = commandMap.get(interaction.commandName);
    await cmd?.autocomplete?.(interaction).catch(() => undefined);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('rk:') && Object.values(BUTTON_IDS).includes(interaction.customId as never)) {
    await handleButton(interaction, s).catch((e: unknown) => log.warn('button failed:', (e as Error).message));
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;
  const ctx: Context = { interaction, ...s, locale: s.settings.get(interaction.guildId).locale };
  log.info(`[${interaction.guildId}] /${interaction.commandName} by ${interaction.user.id}`);
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
