# syntax=docker/dockerfile:1
# =============================================================================
# Build stage — compile TypeScript and build native modules.
#
# `@actual-app/api` pulls in `better-sqlite3`, which on alpine has no prebuilt
# binary and needs python3/make/g++ to compile from source at install time.
# =============================================================================
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
# Single install with all deps (prod + dev). devDeps are needed to run `tsc`;
# the runtime stage prunes them out below before copying node_modules.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build
# Drop devDeps in-place. Reuses the already-built native modules so we don't
# need python3/make/g++ in the runtime image.
RUN npm prune --omit=dev

# =============================================================================
# Runtime stage — minimal alpine + node, non-root user, healthcheck, volume.
# =============================================================================
FROM node:22-alpine AS runtime
# dumb-init handles PID 1 signal forwarding/zombie reaping cleanly. STOPSIGNAL
# alone is not a substitute — it controls which signal Docker sends, not how
# the process tree handles it.
RUN apk add --no-cache dumb-init
RUN addgroup -g 10001 actualmcp && adduser -u 10001 -G actualmcp -S actualmcp
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
RUN mkdir -p /var/lib/actual-mcp && chown actualmcp:actualmcp /var/lib/actual-mcp
USER actualmcp
ENV NODE_ENV=production
EXPOSE 3000
VOLUME ["/var/lib/actual-mcp"]
# Use `node` itself for the healthcheck — it's already in the image, no extra
# package (wget/curl) required, and avoids attack surface. The /health endpoint
# is mounted before auth in src/app.ts so it's reachable without a key.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["dumb-init", "--", "node", "build/src/index.js"]
