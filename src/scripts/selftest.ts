/**
 * End-to-end audio self-test (no slash commands needed): logs in, joins a voice channel of
 * DISCORD_GUILD_ID, plays each query for a few seconds and reports whether the player reached
 * "playing" and how many PCM bytes ffmpeg produced. Posts nothing in text channels.
 *
 *   node dist/scripts/selftest.js "query or url" "another url" ...
 *   SELFTEST_CHANNEL_ID=<voice channel id> SELFTEST_SECONDS=8 node dist/scripts/selftest.js ...
 */
import { AudioPlayerStatus } from '@discordjs/voice';
import { ChannelType, Client, GatewayIntentBits } from 'discord.js';
import { loadConfig } from '../config.js';
import { SettingsStore } from '../db/settings.js';
import { PlayerManager } from '../player/manager.js';
import { configureFfmpeg } from '../player/stream.js';
import { resolveQuery, toTrack } from '../sources/resolver.js';
import { configureSpotify } from '../sources/spotify.js';
import { configureYtdlp } from '../sources/ytdlp.js';
import { log, setLogLevel } from '../util/logger.js';

const config = loadConfig();
setLogLevel(config.logLevel);
configureYtdlp({ binary: config.ytdlpPath, cookies: config.ytdlpCookies, jsRuntime: config.ytdlpJsRuntime });
configureFfmpeg(config.ffmpegPath);
configureSpotify(config.spotifyClientId, config.spotifyClientSecret);

const queries = process.argv.slice(2);
if (!config.guildId || queries.length === 0) {
  console.error('usage: DISCORD_GUILD_ID must be set; pass one or more queries/URLs');
  process.exit(2);
}
const seconds = Number(process.env.SELFTEST_SECONDS ?? 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const settings = new SettingsStore(':memory:', 'es');
const manager = new PlayerManager(client, settings, 60_000);

client.once('clientReady', async () => {
  const guild = await client.guilds.fetch(config.guildId!);
  await guild.channels.fetch();
  const wanted = process.env.SELFTEST_CHANNEL_ID;
  const voiceChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice);
  const channel =
    (wanted ? voiceChannels.get(wanted) : undefined) ??
    voiceChannels.find((c) => c.isVoiceBased() && c.members.size === 0 && c.joinable) ??
    voiceChannels.find((c) => c.isVoiceBased() && c.joinable);
  if (!channel?.isVoiceBased()) throw new Error('no joinable voice channel');
  const player = manager.getOrCreate(guild.id);
  player.stay247 = true; // stop() must not leave the channel between tests
  await player.connect(channel);
  console.log(`SELFTEST joined voice channel "${channel.name}"`);
  const results: string[] = [];
  for (const q of queries) {
    const started = Date.now();
    const packetsBefore = player.voiceStats().packets;
    try {
      const res = await resolveQuery(q);
      const first = res.tracks[0];
      if (!first) throw new Error('no tracks');
      const track = toTrack(first, { id: client.user!.id, name: 'selftest' });
      await player.enqueue([track]);
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await sleep(500);
        reached = player.audio.state.status === AudioPlayerStatus.Playing && player.positionMs > 0;
      }
      await sleep(seconds * 1000);
      const status = player.audio.state.status;
      const v = player.voiceStats();
      const ok = reached && player.pcmBytes > 0 && player.pcmPeak > 500 && v.packets > packetsBefore;
      const line = `${ok ? 'PASS' : 'FAIL'} ${q} -> "${track.title}" [${res.tracks.length} track(s)${res.playlistName ? ` from "${res.playlistName}"` : ''}] status=${status} pcmBytes=${player.pcmBytes} peak=${player.pcmPeak} udpPackets=+${v.packets - packetsBefore} enc=${v.encryption} dave=${v.dave} positionMs=${player.positionMs} startupMs=${Date.now() - started - seconds * 1000}`;
      console.log(`SELFTEST ${line}`);
      results.push(line);
      await player.stop().catch(() => undefined);
    } catch (e) {
      const line = `FAIL ${q}: ${(e as Error).message}`;
      console.log(`SELFTEST ${line}`);
      results.push(line);
    }
  }
  if (process.env.SELFTEST_EXTRAS === '1') await extras(player);
  player.stay247 = false;
  player.destroy();
  await client.destroy();
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`SELFTEST done: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});

/** Filters, seek, skip, loop and previous on a 2-song queue. */
async function extras(player: ReturnType<PlayerManager['getOrCreate']>): Promise<void> {
  const a = (await resolveQuery('lofi hip hop short instrumental')).tracks[0]!;
  const b = (await resolveQuery('daft punk one more time')).tracks[0]!;
  await player.enqueue([toTrack(a, { id: '0', name: 't' }), toTrack(b, { id: '0', name: 't' })]);
  await sleep(6000);
  const check = (label: string, ok: boolean) => console.log(`SELFTEST ${ok ? 'PASS' : 'FAIL'} extra:${label} status=${player.audio.state.status} pos=${player.positionMs} bytes=${player.pcmBytes}`);
  check('queue-start', player.audio.state.status === AudioPlayerStatus.Playing);
  await player.seek(60_000);
  await sleep(3000);
  check('seek-60s', player.positionMs >= 60_000);
  await player.setFilters(['nightcore', 'bassboost']);
  await sleep(3000);
  check('filters', player.audio.state.status === AudioPlayerStatus.Playing && player.pcmBytes > 0);
  await player.setFilters([]);
  player.queue.loop = 'track';
  player.skip();
  await sleep(5000);
  check('skip-to-second', player.queue.current?.title === b.title && player.pcmBytes > 0);
  const prev = await player.previous();
  await sleep(4000);
  check('previous', prev?.title === a.title && player.audio.state.status === AudioPlayerStatus.Playing);
  player.setVolume(50);
  check('volume', player.volume === 50);
  player.pause();
  await sleep(1000);
  check('pause', player.isPaused);
  player.resume();
  await sleep(1500);
  check('resume', player.audio.state.status === AudioPlayerStatus.Playing);
  await player.stop();
}

process.on('unhandledRejection', (e) => {
  log.error('selftest error', e);
  process.exit(1);
});
await client.login(config.token);
