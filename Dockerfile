# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
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
# build, then keep only production dependencies (re-linked from the store, no downloads)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm build && rm -rf node_modules && pnpm install --frozen-lockfile --prod --offline

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp from PyPI in its own venv (starts much faster than the single-file build) and
# upgraded at container start, see docker/entrypoint.sh
RUN python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip "yt-dlp[default]" \
  && chown -R node:node /opt/yt-dlp
ENV NODE_ENV=production \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    YTDLP_JS_RUNTIME=node \
    YTDLP_CACHE_DIR=/app/data/yt-dlp-cache \
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
