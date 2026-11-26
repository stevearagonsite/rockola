import { ChannelType, PermissionFlagsBits, type GuildMember, type VoiceBasedChannel } from 'discord.js';
import type { MessageKey } from '../i18n/index.js';

export type VoiceProblem = 'viewChannel' | 'connect' | 'speak' | 'full' | 'stageSpeak';

export interface VoiceAccess {
  viewChannel: boolean;
  connect: boolean;
  speak: boolean;
  /** Can join even when the channel is full (Move Members). */
  moveMembers: boolean;
  /** Stage channels need Mute Members (or a moderator) to become a speaker. */
  muteMembers: boolean;
  isStage: boolean;
  userLimit: number;
  memberCount: number;
}

/**
 * Returns the first reason the bot cannot play in a voice channel, or null if it can.
 * Discord denies every channel permission when View Channel is missing, so it is checked first.
 */
export function voiceProblem(a: VoiceAccess): VoiceProblem | null {
  if (!a.viewChannel) return 'viewChannel';
  if (!a.connect) return 'connect';
  if (a.isStage) {
    if (!a.muteMembers) return 'stageSpeak';
  } else if (!a.speak) return 'speak';
  if (a.userLimit > 0 && a.memberCount >= a.userLimit && !a.moveMembers) return 'full';
  return null;
}

export function voiceAccess(channel: VoiceBasedChannel, me: GuildMember): VoiceAccess {
  const perms = channel.permissionsFor(me);
  const has = (flag: bigint) => perms.has(flag);
  return {
    viewChannel: has(PermissionFlagsBits.ViewChannel),
    connect: has(PermissionFlagsBits.Connect),
    speak: has(PermissionFlagsBits.Speak),
    moveMembers: has(PermissionFlagsBits.MoveMembers),
    muteMembers: has(PermissionFlagsBits.MuteMembers),
    isStage: channel.type === ChannelType.GuildStageVoice,
    userLimit: channel.userLimit ?? 0,
    memberCount: channel.members.size,
  };
}

export const VOICE_PROBLEM_KEY: Record<VoiceProblem, MessageKey> = {
  viewChannel: 'voice.missingView',
  connect: 'voice.missingConnect',
  speak: 'voice.missingSpeak',
  full: 'voice.full',
  stageSpeak: 'voice.stage',
};
