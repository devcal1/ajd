FROM node:24-bookworm-slim

# System Chromium (for Puppeteer, wired up in Stage 5) instead of letting
# puppeteer download its own bundled Chromium — keeps the image smaller.
# tzdata so the TZ env var (nightly backup scheduling, src/backup.js) actually
# shifts local time instead of silently staying on UTC.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    tzdata \
  && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=3000 \
    DATA_DIR=/app/data
EXPOSE 3000

CMD ["node", "src/index.js"]
