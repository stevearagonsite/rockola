/** Commands that keep working outside the music channel (admins must be able to fix the setting). */
const EXEMPT = new Set(['settings']);

/**
 * Returns the channel a command must be redirected to, or null when it may run where it was used.
 */
export function redirectChannel(
  musicChannelId: string | null | undefined,
  commandName: string,
  channelId: string | null | undefined,
): string | null {
  const music = musicChannelId ? String(musicChannelId).trim() : '';
  if (!music || EXEMPT.has(commandName)) return null;
  // Applies to everyone (admins can bypass Discord's own per-channel command permissions).
  return channelId !== null && channelId !== undefined && String(channelId).trim() === music ? null : music;
}
