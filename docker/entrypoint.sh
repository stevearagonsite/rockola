#!/bin/sh
set -e
# The image pins a yt-dlp version known to play; YTDLP_AUTO_UPDATE=true upgrades it at every start.
if [ "${YTDLP_AUTO_UPDATE:-false}" = "true" ] && [ -x /opt/yt-dlp/bin/pip ]; then
  timeout 120 /opt/yt-dlp/bin/pip install --no-cache-dir -q --upgrade "yt-dlp[default]" >/dev/null 2>&1 \
    || echo "yt-dlp update skipped"
fi
echo "yt-dlp $("$YTDLP_PATH" --version 2>/dev/null || echo missing), $(ffmpeg -version | head -n1)"
exec "$@"
