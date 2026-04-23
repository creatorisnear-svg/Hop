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

# Build SPA + bundle API server
RUN pnpm --filter @workspace/neuro-brain run build \
 && pnpm --filter @workspace/api-server run build

# ----- Runtime image -----
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Copy bundled API server (single esbuild output) and the SPA build
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/neuro-brain/dist/public ./dist/public

# Copy drizzle config + schema for first-boot db push
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules

COPY koyeb/start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=8080
EXPOSE 8080

CMD ["/app/start.sh"]
