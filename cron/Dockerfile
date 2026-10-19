FROM node:24-alpine
WORKDIR /app
COPY trigger.mjs /app/cron-trigger.mjs
USER node
CMD ["node", "/app/cron-trigger.mjs"]
