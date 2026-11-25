/**
 * Registers the slash commands.
 *   npm run deploy-commands            -> test guild (DISCORD_GUILD_ID) if set, else global
 *   npm run deploy-commands -- --global -> global (all servers, may take up to an hour)
 */
import { loadConfig } from '../config.js';
import { registerCommands } from '../discord/registry.js';

const config = loadConfig();
const global = process.argv.includes('--global');
const guildId = global ? undefined : config.guildId;
const n = await registerCommands(config.token, config.clientId, guildId);
console.log(`Registered ${n} commands ${guildId ? `in guild ${guildId}` : 'globally'}.`);
