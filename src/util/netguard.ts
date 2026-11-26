import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * SSRF guard for user-supplied links. /play accepts any http(s) URL and hands it to yt-dlp and
 * ffmpeg, which run inside the bot's network: without this check a member could make the bot
 * request localhost, the LAN, Docker service names or a cloud metadata endpoint.
 */
export class BlockedUrlError extends Error {
  constructor(reason: string) {
    super(`blocked URL: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 3], // multicast + reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 (can reach internal IPv4)
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** IPv4 address embedded in an IPv4-mapped/compatible IPv6 address (::ffff:a.b.c.d), if any. */
function embeddedIPv4(ip: string): string | null {
  const m = /^::(?:ffff:)?(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2]!, 16);
  const lo = parseInt(m[3]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for addresses on the public internet; false for loopback, private, link-local, etc. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return !blocked.check(ip, 'ipv4');
  if (version === 6) {
    const v4 = embeddedIPv4(ip);
    if (v4) return isIP(v4) === 4 && !blocked.check(v4, 'ipv4');
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

export type Lookup = (hostname: string) => Promise<string[]>;

const systemLookup: Lookup = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Checks that `raw` is an http(s) URL whose host resolves only to public addresses and returns
 * its normalized form (pass that one on, so every tool parses the same URL). Throws
 * BlockedUrlError otherwise. Redirects and DNS rebinding are not covered: the network egress
 * policy is the second layer.
 */
export async function assertPublicUrl(raw: string, lookup: Lookup = systemLookup): Promise<string> {
  // Node's URL parser silently fixes these, but Python (yt-dlp) and ffmpeg read them differently
  // (e.g. "http://a.com\\@127.0.0.1/" is a.com for Node and 127.0.0.1 for ffmpeg): refuse them.
  // eslint-disable-next-line no-control-regex
  if (/[\\\x00-\x20\x7f]/.test(raw)) throw new BlockedUrlError('ambiguous characters in URL');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError('not a URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedUrlError(`scheme ${u.protocol}`);
  // user:pass@host is parsed differently by Node and Python (yt-dlp): refuse it outright
  if (u.username || u.password) throw new BlockedUrlError('credentials in URL');
  const host = u.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (!host) throw new BlockedUrlError('empty host');
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError('non-public address');
    return u.href;
  }
  if (host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new BlockedUrlError('internal host name');
  }
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new Error(`could not resolve ${host}`);
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new BlockedUrlError('host resolves to a non-public address');
  return u.href;
}
