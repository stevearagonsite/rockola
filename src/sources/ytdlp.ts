import { execFile } from 'node:child_process';

export interface YtdlpOptions {
  binary: string;
  cookies?: string;
  jsRuntime?: string;
  timeoutMs?: number;
}

let options: YtdlpOptions = { binary: 'yt-dlp' };

export function configureYtdlp(next: YtdlpOptions): void {
  options = next;
}

/** Raw entry shape returned by `yt-dlp -J` (only the fields we read). */
export interface YtdlpInfo {
  _type?: string;
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  original_url?: string;
  ie_key?: string;
  extractor_key?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  creator?: string;
  duration?: number | null;
  is_live?: boolean;
  live_status?: string | null;
  thumbnail?: string;
  thumbnails?: { url: string; width?: number; height?: number }[];
  http_headers?: Record<string, string>;
  entries?: (YtdlpInfo | null)[];
  requested_formats?: YtdlpInfo[];
  acodec?: string;
}

export class YtdlpError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
    this.name = 'YtdlpError';
  }
}

function baseArgs(): string[] {
  const args = ['--no-warnings', '--no-progress', '--ignore-config', '--no-cache-dir'];
  if (options.cookies) args.push('--cookies', options.cookies);
  if (options.jsRuntime) args.push('--js-runtimes', options.jsRuntime);
  return args;
}

/** Runs yt-dlp and parses its single JSON document (-J). */
export function ytdlpJson(target: string, extra: string[] = [], timeoutMs = options.timeoutMs ?? 45_000): Promise<YtdlpInfo> {
  const args = [...baseArgs(), '-J', ...extra, '--', target];
  return new Promise((resolve, reject) => {
    execFile(options.binary, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const firstError = stderr.split('\n').find((l) => l.startsWith('ERROR')) ?? err.message;
        reject(new YtdlpError(firstError.replace(/^ERROR:\s*/, '').slice(0, 300), stderr));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as YtdlpInfo);
      } catch (e) {
        reject(new YtdlpError(`invalid yt-dlp output: ${(e as Error).message}`, stderr));
      }
    });
  });
}

export function ytdlpVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(options.binary, ['--version'], { timeout: 15_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
  });
}

export function bestThumbnail(info: YtdlpInfo): string | undefined {
  if (info.thumbnail) return info.thumbnail;
  const list = info.thumbnails ?? [];
  const sorted = [...list].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url ?? (info.id && info.ie_key === 'Youtube' ? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg` : undefined);
}
