FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install && PAYLOAD_SECRET=build ENCRYPTION_KEY=build pnpm --filter server build
WORKDIR /repo/apps/server
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["pnpm", "start"]
