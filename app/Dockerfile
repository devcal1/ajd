FROM node:24-bookworm-slim

# System Chromium (for Puppeteer, wired up in Stage 5) instead of letting
# puppeteer download its own bundled Chromium — keeps the image smaller.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
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
