FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src ./src
HEALTHCHECK --interval=5m --timeout=30s --start-period=10m --retries=3 \
  CMD ["node", "src/scripts/healthcheck.js"]
CMD ["node", "src/index.js"]
