'use strict';

const http = require('http');

// ── Configuration 
const LB_PORT = 8080;

const BACKENDS = [
  { host: 'localhost', port: 5001 },
  { host: 'localhost', port: 5002 },
  { host: 'localhost', port: 5003 },
];

// ── Round Robin State 
let currentIndex = 0;

function getNextBackend() {
  const backend = BACKENDS[currentIndex];
  currentIndex = (currentIndex + 1) % BACKENDS.length;
  return backend;
}

// ── Logger 
function log(message) {
  console.log(`[${new Date().toISOString()}] [load-balancer] ${message}`);
}

// ── Proxy Logic 
function forwardRequest(clientReq, clientRes) {
  const backend = getNextBackend();
  const target = `${backend.host}:${backend.port}`;

  log(`${clientReq.method} ${clientReq.url} → forwarding to ${target}`);

  const options = {
    hostname: backend.host,
    port:     backend.port,
    path:     clientReq.url,
    method:   clientReq.method,
    headers:  {
      ...clientReq.headers,
      // Tell the backend who the real client is
      'x-forwarded-for': clientReq.socket.remoteAddress,
      // Identify the load balancer
      'x-forwarded-by': 'node-load-balancer',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    log(`← response from ${target}: HTTP ${proxyRes.statusCode}`);

    // Relay status + headers back to the original client
    clientRes.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'x-handled-by': target, // handy for testing
    });

    // Pipe backend response body → client
    proxyRes.pipe(clientRes, { end: true });
  });

  // ── Backend Unreachable 
  proxyReq.on('error', (err) => {
    log(`ERROR reaching ${target}: ${err.message}`);

    // Only send an error response if headers haven't been sent yet
    if (!clientRes.headersSent) {
      const errorBody = JSON.stringify({
        error: 'Bad Gateway',
        message: `Could not reach backend at ${target}`,
        detail: err.message,
      });

      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(errorBody);
    }
  });

  // Pipe client request body → backend (important for POST/PUT)
  clientReq.pipe(proxyReq, { end: true });
}

// ── Server Setup 
const server = http.createServer(forwardRequest);

function shutdown(signal) {
  log(`Received ${signal}. Shutting down gracefully…`);
  server.close(() => {
    log('Load balancer stopped.');
    process.exit(0);
  });
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(LB_PORT, () => {
  log(`Load balancer listening on port ${LB_PORT}`);
  log(`Backends: ${BACKENDS.map(b => `${b.host}:${b.port}`).join(' | ')}`);
  log('Algorithm: Round Robin');
});