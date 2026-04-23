FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

# Build SPA + bundle API server (esbuild produces a single self-contained dist/index.mjs)
RUN pnpm --filter @workspace/neuro-brain run build \
 && pnpm --filter @workspace/api-server run build

# Runtime-only deps for the drizzle push step
RUN mkdir /runtime-deps && cd /runtime-deps \
 && npm init -y > /dev/null \
 && npm install --omit=dev --no-audit --no-fund \
      drizzle-kit@0.31.9 \
      drizzle-orm@0.45.2 \
      pg@8.20.0 \
      @google/genai@1.50.1

# ----- Slim runtime image -----
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Bundled API server (single file) + built SPA assets
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/neuro-brain/dist/public ./dist/public

# Just enough to run `drizzle-kit push` against the schema on first boot
COPY --from=builder /runtime-deps/node_modules ./node_modules
COPY --from=builder /app/lib/db ./lib/db

COPY koyeb/start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=8080
EXPOSE 8080

CMD ["/app/start.sh"]
