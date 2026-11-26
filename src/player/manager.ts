import type { Client, VoiceState } from 'discord.js';
import type { SettingsStore } from '../db/settings.js';
import { GuildPlayer } from './guildPlayer.js';

export class PlayerManager {
  private readonly players = new Map<string, GuildPlayer>();

  constructor(
    private readonly client: Client,
    private readonly settings: SettingsStore,
    private readonly idleTimeoutMs: number,
  ) {}

  get(guildId: string): GuildPlayer | undefined {
    return this.players.get(guildId);
  }

  getOrCreate(guildId: string): GuildPlayer {
    let player = this.players.get(guildId);
    if (!player) {
      player = new GuildPlayer({
        guildId,
        settings: this.settings,
        idleTimeoutMs: this.idleTimeoutMs,
        botUserId: this.client.user?.id ?? '0',
        findChannel: (channelId) => {
          const channel = this.client.channels.cache.get(channelId);
          return channel && 'guildId' in channel && channel.guildId === guildId && channel.isSendable() ? channel : null;
        },
        onDestroy: (id) => {
          if (this.players.get(id) === player) this.players.delete(id);
        },
      });
      this.players.set(guildId, player);
    }
    return player;
  }

  get size(): number {
    return this.players.size;
  }

  /** Leaves after a while when nobody is listening; cancels that when someone comes back. */
  handleVoiceState(oldState: VoiceState, newState: VoiceState): void {
    const guildId = newState.guild.id;
    const player = this.players.get(guildId);
    if (!player) return;
    const botId = this.client.user?.id;
    // the bot itself was disconnected/moved by someone
    if (newState.id === botId) {
      if (!newState.channelId) player.destroy();
      return;
    }
    const channelId = player.channelId;
    if (!channelId || (oldState.channelId !== channelId && newState.channelId !== channelId)) return;
    const channel = newState.guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) return;
    const listeners = channel.members.filter((m) => !m.user.bot).size;
    if (listeners === 0) player.startIdleTimer();
    else if (player.queue.current) player.clearIdleTimer();
  }

  destroyAll(): void {
    for (const p of [...this.players.values()]) p.destroy();
  }
}
