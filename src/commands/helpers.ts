import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type InteractionReplyOptions,
  type VoiceBasedChannel,
} from 'discord.js';
import { t, type MessageKey } from '../i18n/index.js';
import type { GuildPlayer } from '../player/guildPlayer.js';
import type { Context } from './types.js';

/** Slash command with an English base description and Spanish localization. */
export function command(name: string, en: string, es: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(en)
    .setDescriptionLocalizations({ 'es-ES': es, 'es-419': es })
    .setContexts(0); // guild only
}

export const ES = (es: string) => ({ 'es-ES': es, 'es-419': es });

export async function reply(ctx: Context, content: string, ephemeral = false): Promise<void> {
  const i = ctx.interaction;
  const payload: InteractionReplyOptions = { content, allowedMentions: { parse: [] } };
  if (i.deferred || i.replied) {
    await i.editReply({ content, allowedMentions: { parse: [] } });
    return;
  }
  if (ephemeral) payload.flags = MessageFlags.Ephemeral;
  await i.reply(payload);
}

export function msg(ctx: Context, key: MessageKey, vars?: Record<string, string | number>): string {
  return t(ctx.locale, key, vars);
}

export async function fail(ctx: Context, key: MessageKey, vars?: Record<string, string | number>): Promise<false> {
  await reply(ctx, `❌ ${msg(ctx, key, vars)}`, true);
  return false;
}

/**
 * Checks the member is in a voice channel the bot can use (and the same one as the bot, if it is
 * already connected). Replies with the reason and returns null otherwise.
 */
export async function memberVoice(ctx: Context): Promise<VoiceBasedChannel | null> {
  const channel = ctx.interaction.member.voice.channel;
  if (!channel) {
    await fail(ctx, 'error.notInVoice');
    return null;
  }
  const player = ctx.manager.get(ctx.interaction.guildId);
  if (player?.channelId && player.channelId !== channel.id) {
    await fail(ctx, 'error.notSameVoice', { channel: `<#${player.channelId}>` });
    return null;
  }
  const me = ctx.interaction.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    await fail(ctx, 'error.noVoicePerms', { channel: `<#${channel.id}>` });
    return null;
  }
  return channel;
}

/** Returns the active player if something is playing and the member is in its channel. */
export async function activePlayer(ctx: Context, requireSameChannel = true): Promise<GuildPlayer | null> {
  const player = ctx.manager.get(ctx.interaction.guildId);
  if (!player?.queue.current) {
    await fail(ctx, 'error.nothingPlaying');
    return null;
  }
  if (requireSameChannel && ctx.interaction.member.voice.channelId !== player.channelId) {
    await fail(ctx, 'error.notSameVoice', { channel: `<#${player.channelId}>` });
    return null;
  }
  return player;
}

/** DJ-role gate: allowed with the role, Manage Server, or when alone with the bot. */
export async function checkDj(ctx: Context): Promise<boolean> {
  const { djRoleId } = ctx.settings.get(ctx.interaction.guildId);
  if (!djRoleId) return true;
  const member = ctx.interaction.member;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.has(djRoleId)) return true;
  const channel = member.voice.channel;
  if (channel && channel.members.filter((m) => !m.user.bot).size === 1) return true;
  return fail(ctx, 'error.djOnly', { role: `<@&${djRoleId}>` });
}
