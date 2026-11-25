#!/bin/sh
set -e
# YouTube changes often; keep yt-dlp current unless disabled.
if [ "${YTDLP_AUTO_UPDATE:-true}" != "false" ]; then
  timeout 60 "$YTDLP_PATH" -U >/dev/null 2>&1 || echo "yt-dlp self-update skipped"
fi
echo "yt-dlp $("$YTDLP_PATH" --version 2>/dev/null || echo missing), $(ffmpeg -version | head -n1)"
exec "$@"
