# Production image for Google Cloud Run. The same image runs locally on the UAT port (npm run uat).
# Stage 1 installs dependencies; stage 2 is the small runtime image without the npm cache.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime

# Install dumb-init for proper signal forwarding and PID 1 zombie handling
RUN apk add --no-cache dumb-init

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./

# Copy application source and assets
# data/ arrives without the local database or uploads (.dockerignore); the app seeds itself on startup
COPY src/ ./src/
COPY data/ ./data/
COPY safe-globe.html ./safe-globe.html
COPY employee-portal.html ./employee-portal.html
COPY ddq-portal.html ddq-manager.html ddq-print.html portal-shared.css portal-shared.js ddq-section-status.js duck-tour.js dilly-loader.js monitoring-ui.js ./
COPY saf-globe.html ./saf-globe.html
COPY assets/ ./assets/
COPY "Final PRD.pdf" ./"Final PRD.pdf"

# Set file permissions for non-root user (security compliance PRD B.11)
RUN chown -R node:node /app

USER node

# Cloud Run sets PORT itself; 8080 is the default everywhere else
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# Health check probe for container platforms
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]
