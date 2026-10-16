FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
# Optional build-only CA bundle for environments with an authenticated TLS proxy.
# Railway builds use the system trust store when this secret is not supplied.
RUN --mount=type=secret,id=platform_ca \
    if [ -f /run/secrets/platform_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/platform_ca NPM_CONFIG_CAFILE=/run/secrets/platform_ca npm ci; \
    else npm ci; fi
COPY --chown=node:node . .
RUN npm run build && chown -R node:node /app/.next
ENV NODE_ENV=production
ENV NPM_CONFIG_CACHE=/tmp/tradelink-runtime-npm-cache
ENV PORT=3000
USER node
EXPOSE 3000
CMD ["npm", "run", "start:production"]
