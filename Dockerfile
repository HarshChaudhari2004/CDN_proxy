# Use an official Node.js runtime as a parent image (Node.js >= 18 recommended for modern Puppeteer)
FROM node:18-slim

# Set the working directory in the container
WORKDIR /app

# --- Install Chromium and dependencies ---
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends \
    # Install Chromium browser package (using 'chromium' instead of 'chromium-browser')
    && apt-get install -y chromium \
    # Clean up apt cache
    && rm -rf /var/lib/apt/lists/*

# --- Set Puppeteer environment variables ---
# Tell Puppeteer where the installed Chromium executable is (adjust path if needed for 'chromium')
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Set the cache directory as suggested by the error message for Koyeb
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
# Skip downloading Chromium during npm install, as we installed it via apt-get
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install Node.js dependencies (use --production if you don't need devDependencies)
RUN npm install

# Copy the rest of your application code into the container
COPY . .

# Koyeb automatically detects the port from the PORT env var or defaults (like 8080, 3000).
# Your code already uses process.env.PORT || 3001, which is good.
# Exposing it here is optional but good practice.
EXPOSE ${PORT:-3001}

# Define the command to run your application using the start script from package.json
CMD [ "npm", "start" ]
