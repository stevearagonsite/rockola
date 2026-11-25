export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export async function fetchText(url: string, timeoutMs = 15_000): Promise<{ text: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).hostname}`);
  return { text: await res.text(), finalUrl: res.url || url };
}

/** Follows redirects of a short link and returns the final URL. */
export async function resolveRedirect(url: string, timeoutMs = 10_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  await res.body?.cancel();
  return res.url || url;
}
