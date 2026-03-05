'use strict';

const http = require('http');

// ── Configuration 
const LB_PORT            = 8080;
const HEALTH_INTERVAL_MS = 3000;   // check every 3 seconds
const HEALTH_TIMEOUT_MS  = 2000;   // mark down if no reply within 2s
const MAX_RETRIES        = 2;      // retry across live backends before giving up

const BACKENDS = [
  { host: 'localhost', port: 5001, id: 'server-1' },
  { host: 'localhost', port: 5002, id: 'server-2' },
  { host: 'localhost', port: 5003, id: 'server-3' },
];

// ── Server State 
// Each entry: { host, port, id, alive: bool, failures: number }
const registry = BACKENDS.map((b) => ({ ...b, alive: true, failures: 0 }));

// ── Logger 
const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function ts() { return new Date().toISOString(); }

function log(color, tag, msg) {
  console.log(`${DIM}[${ts()}]${RESET} ${color}[${tag}]${RESET} ${msg}`);
}

const logger = {
  req  : (msg) => log(CYAN,   'REQUEST', msg),
  up   : (msg) => log(GREEN,  'UP     ', msg),
  down : (msg) => log(RED,    'DOWN   ', msg),
  info : (msg) => log(YELLOW, 'INFO   ', msg),
  err  : (msg) => log(RED,    'ERROR  ', msg),
};

// ── Health Checks 
function pingServer(server) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: server.host, port: server.port, path: '/', timeout: HEALTH_TIMEOUT_MS },
      (res) => {
        // Drain the response so the socket is released
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error',   ()  => resolve(false));
  });
}

async function runHealthChecks() {
  for (const server of registry) {
    const wasAlive = server.alive;
    const isAlive  = await pingServer(server);

    if (isAlive) {
      server.failures = 0;
      if (!wasAlive) {
        server.alive = true;
        logger.up(`${server.id} (${server.host}:${server.port}) is back online ✓`);
        logRegistryStatus();
      }
    } else {
      server.failures++;
      if (wasAlive) {
        server.alive = false;
        logger.down(`${server.id} (${server.host}:${server.port}) is unreachable ✗`);
        logRegistryStatus();
      }
    }
  }
}

function startHealthChecks() {
  // Stagger: run immediately, then on interval
  runHealthChecks();
  setInterval(runHealthChecks, HEALTH_INTERVAL_MS);
}

function logRegistryStatus() {
  const summary = registry
    .map((s) => `${s.id}:${s.alive ? `${GREEN}UP${RESET}` : `${RED}DOWN${RESET}`}`)
    .join('  ');
  logger.info(`Backend status → ${summary}`);
}

// ── Round Robin (live servers only) 
let rrIndex = 0;

function getNextLiveBackend(excluded = new Set()) {
  const live = registry.filter((s) => s.alive && !excluded.has(s.id));
  if (live.length === 0) return null;

  // Advance round-robin pointer until we land on a live server
  let attempts = 0;
  while (attempts < registry.length) {
    const candidate = registry[rrIndex % registry.length];
    rrIndex = (rrIndex + 1) % registry.length;
    if (candidate.alive && !excluded.has(candidate.id)) return candidate;
    attempts++;
  }
  // Fallback: just pick the first available live server
  return live[0];
}

// ── HTTP Proxy 
function forwardTo(server, clientReq, clientRes, attempt = 1, tried = new Set()) {
  tried.add(server.id);

  const options = {
    hostname : server.host,
    port     : server.port,
    path     : clientReq.url,
    method   : clientReq.method,
    headers  : {
      ...clientReq.headers,
      'x-forwarded-for' : clientReq.socket.remoteAddress,
      'x-forwarded-by'  : 'node-lb-health',
    },
  };

  // We need to buffer the body so we can replay it on retry
  const body = clientReq._lbBody;     // set before first call

  const proxyReq = http.request(options, (proxyRes) => {
    logger.req(
      `${clientReq.method} ${clientReq.url} → ${server.id}:${server.port}  ` +
      `[HTTP ${proxyRes.statusCode}]` +
      (attempt > 1 ? ` (retry #${attempt - 1})` : ''),
    );

    clientRes.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'x-handled-by': `${server.id}:${server.port}`,
    });
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on('error', (err) => {
    logger.err(`${server.id}:${server.port} → ${err.message}`);

    // Opportunistically mark this server down immediately
    if (server.alive) {
      server.alive = false;
      logger.down(`${server.id} marked DOWN after request failure`);
      logRegistryStatus();
    }

    if (attempt <= MAX_RETRIES) {
      const next = getNextLiveBackend(tried);
      if (next) {
        logger.info(`Retrying → ${next.id}:${next.port}  (attempt ${attempt + 1})`);
        return forwardTo(next, clientReq, clientRes, attempt + 1, tried);
      }
    }

    // All retries exhausted
    if (!clientRes.headersSent) {
      const errBody = JSON.stringify({
        error   : 'Service Unavailable',
        message : 'No healthy backend servers are available.',
      });
      clientRes.writeHead(503, { 'Content-Type': 'application/json' });
      clientRes.end(errBody);
    }
  });

  // Write buffered body (needed for POST/PUT retries)
  if (body && body.length) proxyReq.write(body);
  proxyReq.end();
}

// ── Request Handler 
function handleRequest(clientReq, clientRes) {
  // Buffer the request body once so retries can replay it
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', () => {
    clientReq._lbBody = Buffer.concat(chunks);

    const server = getNextLiveBackend();
    if (!server) {
      logger.err('No live backends available for incoming request');
      const errBody = JSON.stringify({
        error   : 'Service Unavailable',
        message : 'All backend servers are currently down.',
      });
      clientRes.writeHead(503, { 'Content-Type': 'application/json' });
      return clientRes.end(errBody);
    }

    forwardTo(server, clientReq, clientRes);
  });
}

// ── Server Boot 
const server = http.createServer(handleRequest);

process.on('SIGINT',  () => { logger.info('Shutting down…'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { logger.info('Shutting down…'); server.close(() => process.exit(0)); });

server.listen(LB_PORT, () => {
  logger.info(`Load balancer (health-aware) listening on port ${LB_PORT}`);
  logger.info(`Backends : ${registry.map((b) => `${b.id} → ${b.host}:${b.port}`).join(' | ')}`);
  logger.info(`Health check every ${HEALTH_INTERVAL_MS / 1000}s  |  Timeout ${HEALTH_TIMEOUT_MS / 1000}s  |  Max retries ${MAX_RETRIES}`);
  startHealthChecks();
});