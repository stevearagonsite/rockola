import { extraCommands } from './extras.js';
import { playbackCommands } from './playback.js';
import { queueCommands } from './queue.js';
import type { Command } from './types.js';

export const commands: Command[] = [...playbackCommands, ...queueCommands, ...extraCommands];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
