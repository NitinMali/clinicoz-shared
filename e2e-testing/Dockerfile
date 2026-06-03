FROM node:20-slim

# Install Chromium dependencies for Playwright
RUN apt-get update && apt-get install -y wget ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install ALL dependencies (need ts-node, typescript at runtime)
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Install Playwright browsers AND their system dependencies
RUN npx playwright install --with-deps chromium

# Copy source code
COPY server.ts ./
COPY src/ ./src/
COPY public/ ./public/

# Create data and cache directories
RUN mkdir -p data cache

EXPOSE 3005

CMD ["npx", "ts-node", "server.ts"]
