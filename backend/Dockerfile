# ── Backend Server ────────────────────────────────────────────────────────────
# Lightweight Node.js image (Alpine = smallest footprint)
FROM node:20-alpine

# Metadata
LABEL maintainer="distributed-systems-project"
LABEL description="Backend HTTP server for the load balancer project"

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only the server file (no package.json needed — zero dependencies)
COPY server.js .

# Switch to non-root user
USER appuser

# Environment variable defaults (overridden by docker-compose)
ENV SERVER_ID=server-1
ENV PORT=5001

# Expose the default port (overridden at runtime)
EXPOSE ${PORT}

# Healthcheck: ping ourselves every 10s
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT} || exit 1

# Use the env vars as CLI args so server.js gets them correctly
CMD ["sh", "-c", "node server.js ${SERVER_ID} ${PORT}"]
