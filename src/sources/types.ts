export type SourceName = 'youtube' | 'spotify' | 'suno' | 'url';

/** How the audio for a track is obtained at play time. */
export type StreamPlan =
  /** Any page yt-dlp understands (YouTube video, SoundCloud, direct file…). */
  | { kind: 'ytdlp'; target: string }
  /** A direct, public audio/video file URL that ffmpeg can read. */
  | { kind: 'direct'; url: string }
  /** Metadata-only track (e.g. Spotify): searched on YouTube when it is about to play. */
  | { kind: 'search'; query: string; durationMs: number | null };

export interface Requester {
  id: string;
  name: string;
}

export interface Track {
  /** Unique per queued item. */
  uid: string;
  title: string;
  author: string;
  /** Canonical page URL shown to users. */
  url: string;
  durationMs: number | null;
  thumbnail?: string;
  source: SourceName;
  plan: StreamPlan;
  requester: Requester;
  /** YouTube video id once known (used by autoplay). */
  youtubeId?: string;
}

/** A track before it is attached to a requester. */
export type TrackInfo = Omit<Track, 'uid' | 'requester'>;

export interface ResolveResult {
  tracks: TrackInfo[];
  /** Set when the input was a playlist/album. */
  playlistName?: string;
}

export interface ResolvedStream {
  url: string;
  headers?: Record<string, string>;
  /** Epoch ms after which url must be re-resolved. */
  expiresAt?: number;
  /** Extra metadata learned while resolving. */
  title?: string;
  durationMs?: number | null;
  youtubeId?: string;
  isLive?: boolean;
}
