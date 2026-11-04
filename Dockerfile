FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates procps && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo
# Manifests first: the install layer is reused until a manifest or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/adapters/package.json packages/adapters/
COPY packages/cli/package.json packages/cli/
COPY packages/runner/package.json packages/runner/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install
COPY . .
# `.next/cache` persists between local builds (a cache mount; CI keeps only the layer cache, no extra action is allow-listed).
RUN --mount=type=cache,id=next-cache,target=/repo/apps/server/.next/cache pnpm build:packages && PAYLOAD_SECRET=build ENCRYPTION_KEY=build pnpm --filter server build
RUN mkdir -p /data/media
WORKDIR /repo/apps/server
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["pnpm", "start"]
