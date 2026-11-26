import { Client, Events, GatewayIntentBits, type Guild } from 'discord.js';
import { loadConfig } from './config.js';
import { SettingsStore } from './db/settings.js';
import { isGuildAllowed } from './discord/guildAllowlist.js';
import { handleInteraction, type Services } from './discord/interactions.js';
import { registerCommands } from './discord/registry.js';
import { PlayerManager } from './player/manager.js';
import { configureFfmpeg } from './player/stream.js';
import { configureSpotify } from './sources/spotify.js';
import { getStream } from './sources/youtube.js';
import { configureYtdlp, ytdlpVersion } from './sources/ytdlp.js';
import { startHeartbeat } from './util/health.js';
import { log, setLogLevel } from './util/logger.js';

const config = loadConfig();
setLogLevel(config.logLevel);
configureYtdlp({
  binary: config.ytdlpPath,
  cookies: config.ytdlpCookies,
  jsRuntime: config.ytdlpJsRuntime,
  cacheDir: config.ytdlpCacheDir,
  maxConcurrency: config.ytdlpMaxConcurrency,
});
configureFfmpeg(config.ffmpegPath);
configureSpotify(config.spotifyClientId, config.spotifyClientSecret);

const settings = new SettingsStore(config.databasePath, config.defaultLocale);
// Only non-privileged intents: slash commands + voice state.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const manager = new PlayerManager(client, settings, config.idleTimeoutMs);
const services: Services = { manager, settings, config };

/** Leaves a server that is not in ALLOWED_GUILD_IDS. Returns true when it left. */
async function leaveIfNotAllowed(guild: Guild): Promise<boolean> {
  if (isGuildAllowed(config.allowedGuildIds, guild.id)) return false;
  log.warn(`leaving server ${guild.id} ("${guild.name}"): not in ALLOWED_GUILD_IDS`);
  await guild.leave().catch((e: unknown) => log.error(`could not leave server ${guild.id}:`, (e as Error).message));
  return true;
}

client.once(Events.ClientReady, async (c) => {
  log.info(`logged in as ${c.user.tag} in ${c.guilds.cache.size} server(s)`);
  if (config.allowedGuildIds.length === 0) log.warn('ALLOWED_GUILD_IDS and DISCORD_GUILD_IDS are empty: the bot works in any server it is added to');
  else log.info(`allowed servers: ${config.allowedGuildIds.join(', ')}`);
  for (const guild of [...c.guilds.cache.values()]) await leaveIfNotAllowed(guild);
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
    if (!isGuildAllowed(config.allowedGuildIds, s.guildId)) continue;
    const channel = await c.channels.fetch(s.stayChannelId!).catch(() => null);
    if (channel?.isVoiceBased()) {
      const player = manager.getOrCreate(s.guildId);
      await player.connect(channel).catch((e: unknown) => log.warn(`24/7 rejoin failed in ${s.guildId}:`, (e as Error).message));
    }
  }
});

// Docker HEALTHCHECK: the file stays fresh while the gateway connection is up.
if (process.env.HEALTH_FILE) startHeartbeat(process.env.HEALTH_FILE, () => client.isReady());

client.on(Events.GuildCreate, (guild) => void leaveIfNotAllowed(guild));
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
