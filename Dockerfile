# Single-container build: API + built React app served from the same origin
FROM node:22-slim AS build
RUN corepack enable && apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter web build && pnpm --filter api build

FROM node:22-slim
RUN corepack enable && apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "cd apps/api && npx prisma db push --skip-generate && node dist/server.js"]
