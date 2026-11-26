/** Commands that keep working outside the music channel (admins must be able to fix the setting). */
const EXEMPT = new Set(['settings']);

/**
 * Returns the channel a command must be redirected to, or null when it may run where it was used.
 */
export function redirectChannel(musicChannelId: string | null, commandName: string, channelId: string | null): string | null {
  if (!musicChannelId || EXEMPT.has(commandName) || channelId === musicChannelId) return null;
  return musicChannelId;
}
