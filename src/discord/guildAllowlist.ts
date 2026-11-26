/**
 * Private-bot mode: with ALLOWED_GUILD_IDS (or DISCORD_GUILD_IDS) set, the bot only works in those
 * servers and leaves any other one it gets added to. An empty list means no restriction.
 */
export function isGuildAllowed(allowed: readonly string[], guildId: string | null | undefined): boolean {
  if (allowed.length === 0) return true;
  return typeof guildId === 'string' && allowed.includes(guildId);
}
