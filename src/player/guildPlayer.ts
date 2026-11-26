import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type AudioResource,
  type VoiceConnection,
} from '@discordjs/voice';
import type { Message, SendableChannels, VoiceBasedChannel } from 'discord.js';
import type { SettingsStore } from '../db/settings.js';
import { controlsRow, nowPlayingEmbed, trackLink } from '../discord/ui.js';
import { t, type Locale, type MessageKey } from '../i18n/index.js';
import { resolveStream, toTrack } from '../sources/resolver.js';
import type { Track } from '../sources/types.js';
import { relatedTracks } from '../sources/youtube.js';
import { log } from '../util/logger.js';
import { buildFilterChain, speedOf, type FilterName } from './filters.js';
import { Queue } from './queue.js';
import { createPcmStream, type PcmStream } from './stream.js';

interface ResourceMeta {
  gen: number;
  track: Track;
}

export interface PlayerDeps {
  guildId: string;
  settings: SettingsStore;
  idleTimeoutMs: number;
  onDestroy: (guildId: string) => void;
  botUserId: string;
  /** Looks up a sendable text channel of this guild by id. */
  findChannel: (channelId: string) => SendableChannels | null;
}

/** One music player per guild: voice connection, queue, filters and the now-playing message. */
export class GuildPlayer {
  readonly queue = new Queue<Track>();
  readonly audio: AudioPlayer;
  connection: VoiceConnection | null = null;
  textChannel: SendableChannels | null = null;
  volume: number;
  filters: FilterName[] = [];
  autoplay: boolean;
  stay247: boolean;

  private gen = 0;
  private pcm: PcmStream | null = null;
  private resource: AudioResource<ResourceMeta> | null = null;
  private seekOffsetMs = 0;
  private speed = 1;
  private skipRequested = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private npMessage: Message | null = null;
  private destroyed = false;
  /** Stats of the last finished track (used by logs and the self-test). */
  lastStats: { title: string; pcmBytes: number; playedMs: number } | null = null;

  constructor(private readonly deps: PlayerDeps) {
    const s = deps.settings.get(deps.guildId);
    this.volume = s.defaultVolume;
    this.autoplay = s.autoplay;
    this.stay247 = s.stay247;
    this.audio = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.audio.on('stateChange', (oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
        const meta = (oldState as { resource?: AudioResource<ResourceMeta> }).resource?.metadata;
        if (meta && meta.gen === this.gen) void this.onTrackEnd();
      }
      if (newState.status === AudioPlayerStatus.Playing && oldState.status !== AudioPlayerStatus.Playing) {
        const track = this.queue.current;
        if (track) {
          const v = this.voiceStats();
          log.info(`[${this.deps.guildId}] playing "${track.title}" (${track.source}) in <#${this.channelId}> voice=${v.status} enc=${v.encryption} dave=${v.dave}`);
        }
      }
    });
    this.audio.on('error', (e) => log.warn(`[${this.deps.guildId}] audio player error:`, e.message));
  }

  get guildId(): string {
    return this.deps.guildId;
  }

  get locale(): Locale {
    return this.deps.settings.get(this.deps.guildId).locale;
  }

  get channelId(): string | null {
    return this.connection?.joinConfig.channelId ?? null;
  }

  get isPaused(): boolean {
    return this.audio.state.status === AudioPlayerStatus.Paused || this.audio.state.status === AudioPlayerStatus.AutoPaused;
  }

  get isPlaying(): boolean {
    return this.audio.state.status !== AudioPlayerStatus.Idle;
  }

  /** Current playback position in ms, accounting for seeks and speed-changing filters. */
  get positionMs(): number {
    if (!this.resource) return 0;
    return Math.round(this.seekOffsetMs + this.resource.playbackDuration * this.speed);
  }

  get pcmBytes(): number {
    return this.pcm?.bytes() ?? 0;
  }

  get pcmPeak(): number {
    return this.pcm?.peak() ?? 0;
  }

  /**
   * What actually went out to Discord: UDP packets sent on this connection, encryption mode and
   * whether DAVE end-to-end encryption is active.
   */
  voiceStats(): { status: string; packets: number; encryption: string; dave: number | null } {
    const state = this.connection?.state as
      | { status: string; networking?: { state: { connectionData?: { sequence?: number; packetsPlayed?: number; encryptionMode?: string }; dave?: { protocolVersion?: number } } } }
      | undefined;
    const net = state?.networking?.state;
    return {
      status: state?.status ?? 'none',
      packets: net?.connectionData?.packetsPlayed ?? 0,
      encryption: net?.connectionData?.encryptionMode ?? 'n/a',
      dave: net?.dave?.protocolVersion ?? null,
    };
  }

  private msg(key: MessageKey, vars?: Record<string, string | number>): string {
    return t(this.locale, key, vars);
  }

  async connect(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection && this.connection.joinConfig.channelId === channel.id &&
        this.connection.state.status !== VoiceConnectionStatus.Destroyed) return;
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection = connection;
    connection.subscribe(this.audio);
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (this.connection === connection) this.destroy();
      }
    });
    connection.on('error', (e) => log.warn(`[${this.deps.guildId}] voice connection error:`, e.message));
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 12_000);
    } catch (e) {
      log.warn(`[${this.deps.guildId}] voice connection not ready:`, (e as Error).message);
      this.destroy();
      throw e;
    }
    if (this.stay247) this.deps.settings.update(this.guildId, { stayChannelId: channel.id });
  }

  /** Adds tracks and starts playing if idle. Returns true when playback started now. */
  async enqueue(tracks: Track[], position?: number): Promise<boolean> {
    this.clearIdleTimer();
    const wasIdle = this.queue.current === null;
    this.queue.add(tracks, position);
    if (wasIdle) {
      const first = this.queue.skip();
      if (first) await this.playTrack(first);
      return true;
    }
    this.prefetchNext();
    return false;
  }

  private prefetchNext(): void {
    const next = this.queue.upcoming[0];
    if (next) resolveStream(next).catch((e: unknown) => log.debug('prefetch failed:', (e as Error).message));
  }

  /** Starts `track` (optionally from `seekMs`). Older pending plays are cancelled. */
  async playTrack(track: Track, seekMs = 0, announce = true): Promise<void> {
    const myGen = ++this.gen;
    this.clearIdleTimer();
    let stream;
    try {
      stream = await resolveStream(track);
    } catch (e) {
      if (myGen !== this.gen) return;
      log.warn(`[${this.guildId}] could not resolve "${track.title}":`, (e as Error).message);
      await this.say(this.msg('error.trackFailed', { title: track.title }));
      const next = this.queue.skip();
      if (next) await this.playTrack(next);
      else await this.onQueueEnd(track);
      return;
    }
    if (myGen !== this.gen || this.destroyed) return;
    this.killStream();
    const pcm = createPcmStream({
      url: stream.url,
      headers: stream.headers,
      seekMs,
      filterChain: buildFilterChain(this.filters),
      hls: stream.hls,
    });
    this.pcm = pcm;
    const resource = createAudioResource<ResourceMeta>(pcm.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: { gen: myGen, track },
    });
    resource.volume?.setVolume(this.volume / 100);
    this.resource = resource;
    this.seekOffsetMs = seekMs;
    this.speed = speedOf(this.filters);
    this.audio.play(resource);
    if (announce) await this.sendNowPlaying(track);
    this.prefetchNext();
  }

  private async onTrackEnd(): Promise<void> {
    const finished = this.queue.current;
    if (finished) {
      this.lastStats = { title: finished.title, pcmBytes: this.pcmBytes, playedMs: this.positionMs };
      const v = this.voiceStats();
      log.info(
        `[${this.guildId}] finished "${finished.title}" pcmBytes=${this.lastStats.pcmBytes} peak=${this.pcmPeak} playedMs=${this.lastStats.playedMs} ` +
          `voice=${v.status} udpPackets=${v.packets} enc=${v.encryption} dave=${v.dave}`,
      );
      if (this.lastStats.pcmBytes === 0 && !this.skipRequested) {
        await this.say(this.msg('error.trackFailed', { title: finished.title }));
      }
    }
    const forced = this.skipRequested || this.lastStats?.pcmBytes === 0;
    this.skipRequested = false;
    const next = forced ? this.queue.skip() : this.queue.next();
    if (next) await this.playTrack(next);
    else await this.onQueueEnd(finished);
  }

  private async onQueueEnd(last: Track | null): Promise<void> {
    this.killStream();
    this.resource = null;
    if (this.autoplay && last) {
      const added = await this.autoplayFrom(last).catch((e: unknown) => {
        log.warn('autoplay failed:', (e as Error).message);
        return false;
      });
      if (added) return;
    }
    await this.clearNowPlaying();
    await this.say(this.msg('player.queueEnded'));
    this.startIdleTimer();
  }

  private async autoplayFrom(last: Track): Promise<boolean> {
    const videoId = last.youtubeId;
    if (!videoId) return false;
    const seen = new Set([...this.queue.history, last].map((h) => h.youtubeId).filter(Boolean));
    const related = await relatedTracks(videoId, 15);
    const pick = related.find((r) => r.youtubeId && !seen.has(r.youtubeId) && r.durationMs !== null && r.durationMs < 15 * 60_000);
    if (!pick) return false;
    const track = toTrack(pick, { id: this.deps.botUserId, name: 'autoplay' });
    await this.say(this.msg('player.autoplayAdded', { title: trackLink(track) }));
    this.queue.add([track]);
    const next = this.queue.skip();
    if (next) await this.playTrack(next);
    return true;
  }

  pause(): boolean {
    return this.audio.pause(true);
  }

  resume(): boolean {
    return this.audio.unpause();
  }

  /** Ends the current track; the queue advances (ignoring track loop). */
  skip(): void {
    this.skipRequested = true;
    if (this.audio.state.status === AudioPlayerStatus.Idle) void this.onTrackEnd();
    else this.audio.stop(true);
  }

  async previous(): Promise<Track | null> {
    const prev = this.queue.previous();
    if (prev) await this.playTrack(prev);
    return prev;
  }

  async jump(position: number): Promise<Track | null> {
    const target = this.queue.jump(position);
    if (target) await this.playTrack(target);
    return target;
  }

  async seek(ms: number): Promise<void> {
    const current = this.queue.current;
    if (!current) return;
    await this.playTrack(current, ms, false);
  }

  async setFilters(filters: FilterName[]): Promise<void> {
    this.filters = filters;
    const current = this.queue.current;
    if (current && this.resource) await this.playTrack(current, this.positionMs, false);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.resource?.volume?.setVolume(volume / 100);
  }

  /** Stops playback and clears the queue. Leaves the channel unless 24/7 mode is on. */
  async stop(): Promise<void> {
    this.gen++;
    this.queue.reset();
    this.audio.stop(true);
    this.killStream();
    this.resource = null;
    await this.clearNowPlaying();
    if (this.stay247) return;
    this.destroy();
  }

  async refreshControls(): Promise<void> {
    if (!this.npMessage) return;
    await this.npMessage.edit({ components: [controlsRow(this.isPaused, this.queue.loop)] }).catch(() => undefined);
  }

  // ----- inactivity -----

  startIdleTimer(): void {
    if (this.stay247 || this.idleTimer || this.destroyed) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.stay247) return;
      void this.say(this.msg('player.leftIdle'));
      this.destroy();
    }, this.deps.idleTimeoutMs);
  }

  clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  // ----- messages -----

  /** Where notifications go: the configured music channel, else the channel of the last command. */
  notifyChannel(): SendableChannels | null {
    const musicChannelId = this.deps.settings.get(this.guildId).musicChannelId;
    if (musicChannelId) return this.deps.findChannel(musicChannelId);
    return this.textChannel;
  }

  async say(content: string): Promise<void> {
    await this.notifyChannel()?.send({ content, allowedMentions: { parse: [] } }).catch((e: unknown) => {
      log.debug('cannot send message:', (e as Error).message);
    });
  }

  private async sendNowPlaying(track: Track): Promise<void> {
    const channel = this.notifyChannel();
    if (!channel) return;
    await this.clearNowPlaying();
    this.npMessage = await channel
      .send({
        embeds: [nowPlayingEmbed(this.locale, this.state(track), false)],
        components: [controlsRow(false, this.queue.loop)],
        allowedMentions: { parse: [] },
      })
      .catch((e: unknown) => {
        log.debug('cannot send now playing:', (e as Error).message);
        return null;
      });
  }

  private async clearNowPlaying(): Promise<void> {
    const old = this.npMessage;
    this.npMessage = null;
    if (old) await old.delete().catch(() => undefined);
  }

  state(track: Track) {
    return {
      track,
      positionMs: this.positionMs,
      volume: this.volume,
      loop: this.queue.loop,
      filters: this.filters,
      autoplay: this.autoplay,
      paused: this.isPaused,
    };
  }

  private killStream(): void {
    this.pcm?.kill();
    this.pcm = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen++;
    this.clearIdleTimer();
    this.audio.stop(true);
    this.killStream();
    void this.clearNowPlaying();
    const conn = this.connection;
    this.connection = null;
    if (conn && conn.state.status !== VoiceConnectionStatus.Destroyed) conn.destroy();
    this.deps.onDestroy(this.guildId);
  }
}
