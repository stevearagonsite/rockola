import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config.js';
import { SettingsStore } from './db/settings.js';
import { handleInteraction, type Services } from './discord/interactions.js';
import { registerCommands } from './discord/registry.js';
import { PlayerManager } from './player/manager.js';
import { configureFfmpeg } from './player/stream.js';
import { configureSpotify } from './sources/spotify.js';
import { getStream } from './sources/youtube.js';
import { configureYtdlp, ytdlpVersion } from './sources/ytdlp.js';
import { log, setLogLevel } from './util/logger.js';

const config = loadConfig();
setLogLevel(config.logLevel);
configureYtdlp({
  binary: config.ytdlpPath,
  cookies: config.ytdlpCookies,
  jsRuntime: config.ytdlpJsRuntime,
  cacheDir: config.ytdlpCacheDir,
});
configureFfmpeg(config.ffmpegPath);
configureSpotify(config.spotifyClientId, config.spotifyClientSecret);

const settings = new SettingsStore(config.databasePath, config.defaultLocale);
// Only non-privileged intents: slash commands + voice state.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const manager = new PlayerManager(client, settings, config.idleTimeoutMs);
const services: Services = { manager, settings, config };

client.once(Events.ClientReady, async (c) => {
  log.info(`logged in as ${c.user.tag} in ${c.guilds.cache.size} server(s)`);
  ytdlpVersion()
    .then((v) => log.info(`yt-dlp ${v}`))
    .catch(() => log.error('yt-dlp not found: set YTDLP_PATH or install it'));
  // Warm yt-dlp's cache (YouTube player challenge) so the first /play is fast.
  const warm = Date.now();
  getStream('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    .then(() => log.info(`yt-dlp warm-up done in ${Date.now() - warm}ms`))
    .catch((e: unknown) => log.warn('yt-dlp warm-up failed:', (e as Error).message));
  for (const guildId of config.guildIds) {
    try {
      const n = await registerCommands(config.token, config.clientId, guildId);
      log.info(`registered ${n} slash commands in guild ${guildId}`);
    } catch (e) {
      log.error(`could not register commands in guild ${guildId}:`, (e as Error).message);
    }
  }
  // Rejoin channels where 24/7 mode is on.
  for (const s of settings.stayingGuilds()) {
    const channel = await c.channels.fetch(s.stayChannelId!).catch(() => null);
    if (channel?.isVoiceBased()) {
      const player = manager.getOrCreate(s.guildId);
      await player.connect(channel).catch((e: unknown) => log.warn(`24/7 rejoin failed in ${s.guildId}:`, (e as Error).message));
    }
  }
});

client.on(Events.InteractionCreate, (i) => void handleInteraction(i, services));
client.on(Events.VoiceStateUpdate, (o, n) => manager.handleVoiceState(o, n));
client.on(Events.Error, (e) => log.error('client error:', e.message));
client.on(Events.ShardDisconnect, () => log.warn('gateway disconnected'));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down`);
  manager.destroyAll();
  await client.destroy();
  settings.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error('unhandled rejection:', e));

await client.login(config.token);
