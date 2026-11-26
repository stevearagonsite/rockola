# Security

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Do not open a public issue. You should get an answer within a
week; fixes land on `main` and the Docker image is rebuilt from it.

Only the latest `main` is supported.

## What the bot does to stay safe

- **Links from users.** `/play` accepts any http(s) link and hands it to yt-dlp and ffmpeg. Before
  that, the host must resolve only to public addresses: localhost, private and link-local ranges
  (including cloud metadata at 169.254.169.254), Docker service names and `.local`/`.internal`
  names are refused. The same check runs again on every playlist entry and on the final media URL.
  ffmpeg only gets the network protocols it needs (`http,https,tls,tcp,crypto`), so an HLS playlist
  cannot make it open `file:` or other local protocols. yt-dlp runs with `--ignore-config` and the
  target always after `--`.
  Redirects and DNS rebinding are not covered by the app: when hosting, block egress to private
  ranges at the network level too.
- **Abuse limits.** `/play`, `/search` and `/lyrics` are limited per member (5 per 30 s) and per
  server (30 per minute); yt-dlp processes are capped across all servers (`YTDLP_MAX_CONCURRENCY`);
  playlists load at most 500 items and a queue holds at most `MAX_QUEUE_SIZE` songs.
- **Private mode.** With `ALLOWED_GUILD_IDS` (default: `DISCORD_GUILD_IDS`) the bot leaves any other
  server on startup and when added, and rejects interactions from them. Commands are registered
  for server installs used in servers only (no DMs, no user installs).
- **Permissions.** `/settings` needs Manage Server (checked by the bot, not only by Discord's
  default). With a DJ role set, playback controls need that role or Manage Server. With a music
  channel set, commands and buttons only work there.
- **Secrets.** Only through environment variables (`.env` is git- and docker-ignored). Logs mask
  Discord tokens, bearer/basic credentials, `user:pass@` in URLs and secret-looking query
  parameters. Users only see short, translated error messages, never raw tool output.
- **Container.** Runs as the unprivileged `node` user from a digest-pinned base image; the compose
  file drops all capabilities and sets `no-new-privileges`. The build context is an allowlist, so
  `.env`, `data/` and cookies never reach the builder.
