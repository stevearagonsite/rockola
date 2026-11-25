# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
# toolchain only used if a native module has no prebuilt binary for this platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp standalone build (self-updates at start, see docker/entrypoint.sh)
RUN mkdir -p /opt/yt-dlp \
  && case "$TARGETARCH" in arm64) f=yt-dlp_linux_aarch64 ;; *) f=yt-dlp_linux ;; esac \
  && curl -fsSL -o /opt/yt-dlp/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$f" \
  && chmod 755 /opt/yt-dlp/yt-dlp && chown -R node:node /opt/yt-dlp
ENV NODE_ENV=production \
    YTDLP_PATH=/opt/yt-dlp/yt-dlp \
    YTDLP_JS_RUNTIME=node \
    DATABASE_PATH=/app/data/rockola.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/rockola-entrypoint
RUN mkdir -p /app/data && chown node:node /app/data && chmod 755 /usr/local/bin/rockola-entrypoint
USER node
VOLUME ["/app/data"]
ENTRYPOINT ["/usr/bin/tini", "--", "rockola-entrypoint"]
CMD ["node", "dist/index.js"]
