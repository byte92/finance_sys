# syntax=docker/dockerfile:1

ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.59.1-noble

FROM ${PLAYWRIGHT_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY scripts/only-pnpm.cjs ./scripts/only-pnpm.cjs
RUN pnpm install --frozen-lockfile --config.node-linker=hoisted

FROM deps AS builder
COPY . .
RUN pnpm build

FROM ${PLAYWRIGHT_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  FINANCE_SQLITE_PATH=/app/data/finance.sqlite \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN mkdir -p /app/data /app/skills/custom \
  && chown -R pwuser:pwuser /app/data /app/skills

COPY --from=builder --chown=pwuser:pwuser /app/.next/standalone ./
COPY --from=builder --chown=pwuser:pwuser /app/.next/static ./.next/static
COPY --from=builder --chown=pwuser:pwuser /app/app/icon.svg ./app/icon.svg
COPY --from=builder --chown=pwuser:pwuser /app/skills ./skills
COPY --from=deps --chown=pwuser:pwuser /app/node_modules/playwright ./node_modules/playwright
COPY --from=deps --chown=pwuser:pwuser /app/node_modules/playwright-core ./node_modules/playwright-core

USER pwuser
VOLUME ["/app/data"]

CMD ["node", "server.js"]
