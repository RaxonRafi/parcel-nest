# syntax=docker/dockerfile:1

# A long-running container, for hosts that keep a process alive (Render,
# Railway, Fly, a VPS). That is what realtime notifications need: a Vercel
# function cannot hold a WebSocket open.

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so only what runs is copied into the final image.
RUN npm prune --omit=dev

# ── Run ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# The image ships with an unprivileged user; there is no reason to be root.
USER node

# The host injects PORT; this is only the default.
ENV PORT=3000
EXPOSE 3000

# Answers 503 until the database is reachable, so the host holds traffic back.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Compiled migrations are in dist/. Apply them with DB_MIGRATIONS_RUN=true, or
# as a release step:  node node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run
CMD ["node", "dist/main"]
