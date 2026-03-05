# ── Load Balancer ─────────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL maintainer="distributed-systems-project"
LABEL description="Round-robin load balancer with active health checks and metrics API"

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY load_balancer_health.js .

USER appuser

# LB port + metrics port
EXPOSE 8080 8090

# Healthcheck: verify the LB is accepting connections
HEALTHCHECK --interval=10s --timeout=3s --start-period=8s --retries=3 \
  CMD wget -qO- http://localhost:8080 || exit 1

CMD ["node", "load_balancer_health.js"]
