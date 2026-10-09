# Production Dockerfile for Google Cloud Run
# Optimized for Node.js 24 Alpine with minimal image size and fast cold-start

FROM node:24-alpine AS base

# Install dumb-init for proper signal forwarding and PID 1 zombie handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install production dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source and assets
COPY src/ ./src/
COPY data/ ./data/
COPY safe-globe.html ./safe-globe.html
COPY employee-portal.html ./employee-portal.html
COPY ddq-portal.html ddq-manager.html ddq-print.html portal-shared.css portal-shared.js ddq-section-status.js duck-tour.js ./
COPY saf-globe.html ./saf-globe.html
COPY assets/ ./assets/
COPY "Final PRD.pdf" ./"Final PRD.pdf"

# Set file permissions for non-root user (security compliance PRD B.11)
RUN chown -R node:node /app

USER node

# Cloud Run defaults PORT to 8080
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# Health check probe for container platforms
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]
