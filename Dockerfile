# syntax=docker/dockerfile:1
# Base image pinned by digest (Dependabot keeps it current).
FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
WORKDIR /app
# toolchain only used if a native module has no prebuilt binary for this platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# pnpm through corepack (version pinned by "packageManager" in package.json)
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 PNPM_HOME=/pnpm
RUN npm install -g corepack@0.36.0 && corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# build, then keep only production dependencies (re-linked from the store; downloads only when the
# cache mount is empty, e.g. a CI runner that restored the install layer from the layer cache)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm build && rm -rf node_modules && pnpm install --frozen-lockfile --prod --prefer-offline

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp from PyPI in its own venv (starts much faster than the single-file build), pinned:
# 2026.11.23 returns googlevideo URLs that ffmpeg gets 403 Forbidden on. Bump YTDLP_VERSION after
# checking a long YouTube video plays (node dist/scripts/probe.js). YTDLP_AUTO_UPDATE=true upgrades
# it at container start instead, see docker/entrypoint.sh
ARG YTDLP_VERSION=2026.10.26
RUN python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip "yt-dlp[default]==${YTDLP_VERSION}" \
  && chown -R node:node /opt/yt-dlp
ENV NODE_ENV=production \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    YTDLP_JS_RUNTIME=node \
    YTDLP_CACHE_DIR=/app/data/yt-dlp-cache \
    DATABASE_PATH=/app/data/rockola.sqlite \
    HEALTH_FILE=/tmp/rockola-health
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/rockola-entrypoint
RUN mkdir -p /app/data && chown node:node /app/data && chmod 755 /usr/local/bin/rockola-entrypoint
USER node
VOLUME ["/app/data"]
# Healthy while the Discord gateway is connected (src/util/health.ts refreshes the file every 30 s).
HEALTHCHECK --interval=60s --timeout=10s --start-period=180s --retries=3 \
  CMD ["node", "-e", "const s=require('fs').statSync(process.env.HEALTH_FILE);process.exit(Date.now()-s.mtimeMs<120000?0:1)"]
ENTRYPOINT ["/usr/bin/tini", "--", "rockola-entrypoint"]
CMD ["node", "dist/index.js"]
