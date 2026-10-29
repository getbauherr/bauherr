FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates procps && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install && pnpm build:packages && PAYLOAD_SECRET=build ENCRYPTION_KEY=build pnpm --filter server build
WORKDIR /repo/apps/server
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["pnpm", "start"]
