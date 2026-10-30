FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_FILE=/data/server.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

# BRANCH_KEYS must be supplied at runtime, e.g. -e BRANCH_KEYS="main:long-random-secret"
CMD ["node", "src/index.js"]
