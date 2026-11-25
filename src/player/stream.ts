import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { log } from '../util/logger.js';

let ffmpegPath = 'ffmpeg';
export function configureFfmpeg(path: string): void {
  ffmpegPath = path;
}

export interface PcmStreamOptions {
  url: string;
  headers?: Record<string, string>;
  seekMs?: number;
  filterChain: string;
}

/** Builds ffmpeg arguments that decode any input to 48 kHz stereo s16le PCM on stdout. */
export function ffmpegArgs(o: PcmStreamOptions): string[] {
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
  if (/^https?:/i.test(o.url)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '5');
    const headers = { ...(o.headers ?? {}) };
    const ua = headers['User-Agent'] ?? headers['user-agent'];
    delete headers['User-Agent'];
    delete headers['user-agent'];
    if (ua) args.push('-user_agent', ua);
    const extra = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join('');
    if (extra) args.push('-headers', extra);
  }
  if (o.seekMs && o.seekMs > 0) args.push('-ss', (o.seekMs / 1000).toFixed(3));
  args.push('-i', o.url, '-vn', '-af', o.filterChain, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');
  return args;
}

export interface PcmStream {
  stream: Readable;
  /** Bytes of PCM produced so far. */
  bytes(): number;
  kill(): void;
}

export function createPcmStream(o: PcmStreamOptions): PcmStream {
  const proc: ChildProcessByStdio<null, Readable, Readable> = spawn(ffmpegPath, ffmpegArgs(o), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bytes = 0;
  let stderr = '';
  let killed = false;
  proc.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 2000) stderr += chunk.toString();
  });
  proc.on('error', (e) => log.error('ffmpeg failed to start:', e.message));
  proc.on('close', (code) => {
    if (code && !killed) log.warn(`ffmpeg exited with code ${code}: ${stderr.trim().slice(0, 500)}`);
  });
  proc.stdout.on('error', () => {
    /* EPIPE when killed */
  });
  return {
    stream: proc.stdout,
    bytes: () => bytes,
    kill: () => {
      killed = true;
      if (proc.exitCode === null) proc.kill('SIGKILL');
    },
  };
}
