<p align="center">
  <img src="assets/banner.png" alt="Rockola: neon jukebox music bot" width="680">
</p>

# Rockola

Free, open-source Discord music bot. Slash commands, a real queue, audio filters and links from
YouTube, Spotify and Suno. Replies in Spanish by default (English available per server).

> Bot de música libre y de código abierto para Discord. Comandos de barra, cola, filtros y links
> de YouTube, Spotify y Suno. Responde en español por defecto (inglés configurable con `/settings`).

## Features

- **Sources**
  - **YouTube**: plain searches, video links (`watch`, `youtu.be`, Shorts, live streams, YouTube Music)
    and playlists.
  - **Spotify**: track, album, playlist and artist links (plus `spotify.link` short links). Spotify does
    not offer audio streaming, so each song is matched to the best YouTube result (duration, artist and
    "official"/"topic" uploads score higher; covers and live versions score lower). Works **without
    credentials** through Spotify's public embed pages (playlists up to ~100 songs);
    optional API credentials give complete playlists.
  - **Suno**: public song links (`suno.com/song/<id>`, `suno.com/s/<code>`) and public playlists, played
    from the public file the song page shares. No login, cookies or API keys.
  - Anything else [yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
    (SoundCloud, Bandcamp, direct audio files…).
- **Commands**: `/play` (with search suggestions), `/search` (pick from 10 results), `/pause`,
  `/resume`, `/skip`, `/previous`, `/stop`, `/queue` (paginated), `/nowplaying` (progress bar),
  `/volume`, `/loop` (off/track/queue), `/shuffle`, `/remove`, `/move`, `/clear`, `/seek`, `/jump`,
  `/filters` (bass boost, nightcore, vaporwave, 8D, off), `/autoplay`, `/247`, `/lyrics`, `/help`,
  `/settings`.
- **Now-playing message** with buttons: pause/resume, skip, stop, loop.
- **Per-server settings** in SQLite: language (es/en), default volume, DJ role, music channel, autoplay, 24/7.
- **Music channel** (`/settings music_channel`): when set, commands used in other channels get a private
  reply pointing there, and every bot message (now playing, queue end, errors, autoplay) is posted only there.
- **DJ role**: when set, only members with that role (or Manage Server, or someone alone with the bot)
  can control playback; anyone can `/play`, `/search`, `/queue`, `/nowplaying` and `/lyrics`.
- Leaves the voice channel after a period of inactivity or when everybody left, unless 24/7 mode is on.
  24/7 channels are rejoined after a restart.
- Lyrics from [LRCLIB](https://lrclib.net) (free, no key).

## How it plays audio (stack)

- Node.js 22 + TypeScript, [discord.js](https://discord.js.org) v14 and `@discordjs/voice` 0.19
  (Discord's DAVE end-to-end voice encryption via `@snazzah/davey`, native Opus via `@discordjs/opus`).
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) resolves YouTube and other sites; `ffmpeg` decodes,
  seeks and applies filters; the bot streams PCM into Discord with inline volume.

Why not Lavalink or discord-player? Both work by wrapping a YouTube extractor that has to keep up
with YouTube changes. yt-dlp is the extractor that gets fixed first when YouTube changes, it updates
itself in the Docker image at every start, and it needs no extra Java service. Keeping the player in
the bot (a small queue + one ffmpeg process per server) also makes filters and seeking simple. For a
bot in a handful of servers this is the most reliable option; for hundreds of servers, Lavalink scales
better.

## Setup

### 1. Discord application

1. Create an application at <https://discord.com/developers/applications>, open **Bot**, and copy the
   token. No privileged intents are needed (the bot only uses `Guilds` and `GuildVoiceStates`).
2. Invite it with this URL (replace `YOUR_CLIENT_ID`). It asks only for Connect, Speak, Send Messages,
   Embed Links and Use Slash Commands:

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=2150647808
   ```

   If your text channels are private, the bot also needs **View Channel** on them.

### 2. Configuration

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token |
| `DISCORD_CLIENT_ID` | yes | Application ID |
| `DISCORD_GUILD_IDS` | no | Comma-separated server IDs: commands are registered there at startup (instant). `DISCORD_GUILD_ID` with one ID also works |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | no | Spotify Web API app; complete playlists. Without them the public embed is used |
| `DEFAULT_LOCALE` | no | `es` (default) or `en` |
| `IDLE_TIMEOUT_SECONDS` | no | Inactivity before leaving (default 180) |
| `DATABASE_PATH` | no | SQLite file (default `./data/rockola.sqlite`) |
| `YTDLP_PATH`, `FFMPEG_PATH` | no | Binaries (default: from `PATH`) |
| `YTDLP_JS_RUNTIME` | no | JS runtime yt-dlp uses for YouTube challenges (`deno` by default; Docker uses `node`) |
| `YTDLP_CACHE_DIR` | no | Persistent yt-dlp cache (faster first play) |
| `YTDLP_COOKIES` | no | Cookies file, only if YouTube starts asking to "confirm you're not a bot" |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn`, `error` |

### 3. Run with Docker (recommended)

```sh
cp .env.example .env   # fill it in
docker compose up -d --build
docker compose logs -f
```

The container restarts on its own (`restart: unless-stopped`), keeps settings in the `rockola-data`
volume and upgrades yt-dlp at every start (`YTDLP_AUTO_UPDATE=false` disables that).

To register the commands in every server (global commands can take up to an hour to appear):

```sh
docker compose run --rm rockola node dist/scripts/deploy-commands.js --global
```

### 4. Run without Docker

Requirements: Node.js 22.13+, [pnpm](https://pnpm.io) (`corepack enable pnpm` picks the version pinned
in `package.json`), ffmpeg, and yt-dlp with a JavaScript runtime (deno, or node via
`YTDLP_JS_RUNTIME=node`).

```sh
pnpm install
pnpm build
pnpm start               # registers commands in DISCORD_GUILD_IDS if set
pnpm run deploy-commands --global   # optional: register everywhere
```

Native modules (`@discordjs/opus`) and `esbuild` are allowed to run their install scripts in
`pnpm-workspace.yaml` (`allowBuilds`); pnpm blocks any other package's scripts.

### Hosting 24/7

Any always-on machine with Docker works (a home PC, a Raspberry Pi 4/5 with 64-bit OS, a small VPS).
YouTube is stricter with datacenter IPs; a home connection usually needs no cookies.

On Windows, run it inside WSL2 (Ubuntu with Docker Engine and systemd) or Docker Desktop with
`docker compose up -d`. The container comes back after reboots as long as Docker starts with Windows
(Docker Desktop: "Start when you sign in"; WSL2: start the distro at logon, e.g. a Task Scheduler
task running `wsl.exe -d Ubuntu-24.04 --exec true`).

## Development

```sh
pnpm dev             # watch mode with tsx
pnpm check           # lint + typecheck + unit tests
node dist/scripts/probe.js "query" "https://…"     # resolve + decode audio, no Discord needed
node dist/scripts/selftest.js "query" "https://…"  # joins a voice channel of DISCORD_GUILD_ID and plays each item
```

`selftest` reports, per item, whether the player reached "playing", the PCM bytes and peak level,
and the encrypted UDP packets sent to Discord (with the encryption mode and DAVE version).

Secrets: a gitleaks pre-commit hook is installed by `pnpm install` (`git config core.hooksPath
.githooks`; requires [gitleaks](https://github.com/gitleaks/gitleaks)). CI runs lint, typecheck,
tests, a Docker build and gitleaks over the full history.

## Legal

Rockola is not affiliated with Discord, YouTube, Spotify or Suno. Streaming or downloading content
from third-party platforms may be subject to their terms of service and to copyright law. You are
responsible for how you run this bot and what you play with it. Spotify links are only used to read
public metadata; audio comes from public sources.

## License

[MIT](LICENSE)
