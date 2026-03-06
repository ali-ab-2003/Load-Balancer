# ── Metrics Dashboard ─────────────────────────────────────────────────────────
# Serves the static dashboard.html over a tiny HTTP server so you can
# open it in your browser at http://localhost:3000
FROM node:20-alpine

LABEL maintainer="distributed-systems-project"
LABEL description="Static file server for the real-time metrics dashboard"

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# dashboard.html is a single self-contained file — no framework needed.
# We serve it with a built-in Node.js one-liner static server.
COPY dashboard.html .

# Write a minimal static file server inline (no npm needed)
RUN printf '%s\n' \
  "'use strict';" \
  "const http = require('http'), fs = require('fs'), path = require('path');" \
  "http.createServer((req, res) => {" \
  "  const file = path.join(__dirname, 'dashboard.html');" \
  "  fs.readFile(file, (err, data) => {" \
  "    if (err) { res.writeHead(500); return res.end('Error'); }" \
  "    res.writeHead(200, { 'Content-Type': 'text/html' });" \
  "    res.end(data);" \
  "  });" \
  "}).listen(3000, () => console.log('[dashboard] Serving on http://localhost:3000'));" \
  > serve.js

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000 || exit 1

CMD ["node", "serve.js"]
