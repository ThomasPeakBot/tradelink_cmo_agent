FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node --chmod=0444 trigger.mjs /app/cron-trigger.mjs
USER node
CMD ["node", "/app/cron-trigger.mjs"]
