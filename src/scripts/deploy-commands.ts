/**
 * Registers the slash commands.
 *   npm run deploy-commands            -> every guild in DISCORD_GUILD_IDS if set, else global
 *   npm run deploy-commands -- --global -> global (all servers, may take up to an hour)
 */
import { loadConfig } from '../config.js';
import { registerCommands } from '../discord/registry.js';

const config = loadConfig();
if (process.argv.includes('--global') || config.guildIds.length === 0) {
  const n = await registerCommands(config.token, config.clientId);
  console.log(`Registered ${n} commands globally.`);
} else {
  for (const guildId of config.guildIds) {
    const n = await registerCommands(config.token, config.clientId, guildId);
    console.log(`Registered ${n} commands in guild ${guildId}.`);
  }
}
