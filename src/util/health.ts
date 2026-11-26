import { writeFileSync } from 'node:fs';

/**
 * Touches `path` every `everyMs` while `isHealthy()` holds, so a container healthcheck can tell a
 * live bot from a hung one by the file's age (the bot has no HTTP port to probe).
 */
export function startHeartbeat(path: string, isHealthy: () => boolean, everyMs = 30_000): () => void {
  const beat = () => {
    if (!isHealthy()) return;
    try {
      writeFileSync(path, String(Date.now()));
    } catch {
      /* unwritable path: the healthcheck will report it */
    }
  };
  beat();
  const timer = setInterval(beat, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
