# Math Heroes — production container
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the app
COPY . .

# Profiles are written here; mount a volume to persist across restarts.
ENV DATA_DIR=/data
VOLUME ["/data"]

ENV PORT=3000
EXPOSE 3000

# Drop to a non-root user for safety
RUN mkdir -p /data && chown -R node:node /data
USER node

CMD ["node", "server/server.js"]
