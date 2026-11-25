#!/bin/sh
set -e
# YouTube changes often; keep yt-dlp current unless disabled (YTDLP_AUTO_UPDATE=false).
if [ "${YTDLP_AUTO_UPDATE:-true}" != "false" ] && [ -x /opt/yt-dlp/bin/pip ]; then
  timeout 120 /opt/yt-dlp/bin/pip install --no-cache-dir -q --upgrade "yt-dlp[default]" >/dev/null 2>&1 \
    || echo "yt-dlp update skipped"
fi
echo "yt-dlp $("$YTDLP_PATH" --version 2>/dev/null || echo missing), $(ffmpeg -version | head -n1)"
exec "$@"
