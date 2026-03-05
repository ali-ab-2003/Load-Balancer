# ── Traffic Simulator ─────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL maintainer="distributed-systems-project"
LABEL description="Concurrent HTTP traffic generator for load balancer testing"

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY traffic_simulator.js .

USER appuser

# How many requests and how much concurrency (overridable via environment)
ENV TOTAL_REQUESTS=1000
ENV CONCURRENCY=50

# No ports needed — this is an outbound-only client container

CMD ["sh", "-c", "node traffic_simulator.js ${TOTAL_REQUESTS} ${CONCURRENCY}"]
