import { REST, Routes } from 'discord.js';
import { commands } from '../commands/index.js';

/** Registers slash commands for one guild (instant) or globally (can take up to an hour). */
export async function registerCommands(token: string, clientId: string, guildId?: string): Promise<number> {
  const rest = new REST().setToken(token);
  const body = commands.map((c) => c.data);
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  const result = (await rest.put(route, { body })) as unknown[];
  return result.length;
}
