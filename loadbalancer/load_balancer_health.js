'use strict';

const http = require('http');

// ── Configuration 
const LB_PORT            = 8080;
const METRICS_PORT       = 8090;
const HEALTH_INTERVAL_MS = 3000;
const HEALTH_TIMEOUT_MS  = 2000;
const MAX_RETRIES        = 2;

// Backends can be overridden via BACKENDS env var as JSON, e.g.:
// BACKENDS='[{"host":"server-1","port":5001,"id":"server-1"}]'
// Falls back to localhost defaults for running outside Docker.
// const BACKENDS = process.env.BACKENDS
//   ? JSON.parse(process.env.BACKENDS)
//   : [
//       { host: 'localhost', port: 5001, id: 'server-1' },
//       { host: 'localhost', port: 5002, id: 'server-2' },
//       { host: 'localhost', port: 5003, id: 'server-3' },
//     ];

function parseBackends() {
  // Render deployment: set individual env vars per backend
  // e.g. BACKEND_1=https://lb-backend-server-1.onrender.com
  const fromEnv = ['https://lb-backend-server-11.onrender.com', 'https://lb-backend-server-2.onrender.com', 'https://lb-backend-server-3.onrender.com']
    .map((key, i) => {
      const url = process.env[key];
      if (!url) return null;
      const parsed = new URL(url);
      return {
        id   : `server-${i + 1}`,
        host : parsed.hostname,
        port : parsed.protocol === 'https:' ? 443 : 80,
        tls  : parsed.protocol === 'https:',
      };
    })
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;

  // Local fallback
  return [
    { host: 'localhost', port: 5001, id: 'server-1', tls: false },
    { host: 'localhost', port: 5002, id: 'server-2', tls: false },
    { host: 'localhost', port: 5003, id: 'server-3', tls: false },
  ];
}

const BACKENDS = parseBackends();

// ── Metrics Store 
const metrics = {
  startTime      : Date.now(),
  totalRequests  : 0,
  totalSuccesses : 0,
  totalFailures  : 0,
  servers        : Object.fromEntries(
    BACKENDS.map((b) => [
      b.id,
      { requests: 0, failures: 0, latencySum: 0, latencyCount: 0, alive: true },
    ]),
  ),
};

function recordSuccess(serverId, latencyMs) {
  metrics.totalRequests++;
  metrics.totalSuccesses++;
  const s = metrics.servers[serverId];
  if (s) { s.requests++; s.latencySum += latencyMs; s.latencyCount++; }
}

function recordFailure(serverId) {
  metrics.totalRequests++;
  metrics.totalFailures++;
  const s = metrics.servers[serverId];
  if (s) { s.requests++; s.failures++; }
}

function getSnapshot() {
  const uptimeSec = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
  return {
    uptimeSec,
    totalRequests  : metrics.totalRequests,
    totalSuccesses : metrics.totalSuccesses,
    totalFailures  : metrics.totalFailures,
    throughput     : uptimeSec > 0
      ? +(metrics.totalRequests / uptimeSec).toFixed(2) : 0,
    servers: Object.entries(metrics.servers).map(([id, s]) => ({
      id,
      alive        : s.alive,
      requests     : s.requests,
      failures     : s.failures,
      avgLatencyMs : s.latencyCount > 0 ? Math.round(s.latencySum / s.latencyCount) : null,
    })),
  };
}

// ── Server Registry 
const registry = BACKENDS.map((b) => ({ ...b, alive: true, failures: 0 }));

// ── Logger 
const RESET = '\x1b[0m'; const GREEN = '\x1b[32m'; const RED = '\x1b[31m';
const YELLOW = '\x1b[33m'; const CYAN = '\x1b[36m'; const DIM = '\x1b[2m';
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
    const lib = server.tls ? require('https') : require('http');
    const req = lib.get(
      { hostname: server.host, port: server.port, path: '/', timeout: HEALTH_TIMEOUT_MS },
      (res) => { res.resume(); resolve(res.statusCode < 500); },
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
        metrics.servers[server.id].alive = true;
        logger.up(`${server.id} is back ONLINE ✓`);
      }
    } else {
      server.failures++;
      if (wasAlive) {
        server.alive = false;
        metrics.servers[server.id].alive = false;
        logger.down(`${server.id} is UNREACHABLE ✗`);
      }
    }
  }
}

function startHealthChecks() {
  runHealthChecks();
  setInterval(runHealthChecks, HEALTH_INTERVAL_MS);
}

// ── Round Robin 
let rrIndex = 0;
function getNextLiveBackend(excluded = new Set()) {
  const live = registry.filter((s) => s.alive && !excluded.has(s.id));
  if (!live.length) return null;
  let attempts = 0;
  while (attempts < registry.length) {
    const c = registry[rrIndex % registry.length];
    rrIndex  = (rrIndex + 1) % registry.length;
    if (c.alive && !excluded.has(c.id)) return c;
    attempts++;
  }
  return live[0];
}

// ── Proxy 
function forwardTo(server, clientReq, clientRes, startMs, attempt = 1, tried = new Set()) {
  tried.add(server.id);
  const lib = server.tls ? require('https') : require('http');
  const proxyReq = lib.request({
    hostname : server.host,
    port     : server.port,
    path     : clientReq.url,
    method   : clientReq.method,
    headers  : {
      ...clientReq.headers,
      'host'            : server.host,
      'x-forwarded-for' : clientReq.socket.remoteAddress,
    },
  }, (proxyRes) => {
    const latency = Date.now() - startMs;
    recordSuccess(server.id, latency);
    logger.req(`${clientReq.method} ${clientReq.url} → ${server.id} [${proxyRes.statusCode}] ${latency}ms`);
    clientRes.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'x-handled-by' : server.id,
    });
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on('error', (err) => {
    recordFailure(server.id);
    logger.err(`${server.id} → ${err.message}`);
    if (server.alive) {
      server.alive = false;
      metrics.servers[server.id].alive = false;
    }
    if (attempt <= MAX_RETRIES) {
      const next = getNextLiveBackend(tried);
      if (next) return forwardTo(next, clientReq, clientRes, startMs, attempt + 1, tried);
    }
    if (!clientRes.headersSent) {
      clientRes.writeHead(503, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'Service Unavailable' }));
    }
  });

  const body = clientReq._lbBody;
  if (body && body.length) proxyReq.write(body);
  proxyReq.end();
}

function handleRequest(clientReq, clientRes) {
  const startMs = Date.now();
  const chunks  = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', () => {
    clientReq._lbBody = Buffer.concat(chunks);
    const server = getNextLiveBackend();
    if (!server) {
      metrics.totalRequests++;
      metrics.totalFailures++;
      clientRes.writeHead(503, { 'Content-Type': 'application/json' });
      return clientRes.end(JSON.stringify({ error: 'All backends down' }));
    }
    forwardTo(server, clientReq, clientRes, startMs);
  });
}

// ── Metrics Server (port 8090) 
const metricsServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.url === '/metrics' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getSnapshot(), null, 2));
  }
  res.writeHead(404); res.end('Not found');
});

// ── Boot 
const lbServer = http.createServer(handleRequest);
lbServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') { logger.err(`Port ${LB_PORT} already in use.`); process.exit(1); }
  else throw err;
});

process.on('SIGINT',  () => { lbServer.close(); metricsServer.close(); process.exit(0); });
process.on('SIGTERM', () => { lbServer.close(); metricsServer.close(); process.exit(0); });

lbServer.listen(LB_PORT, () => {
  logger.info(`Load balancer      → http://localhost:${LB_PORT}`);
  startHealthChecks();
});
metricsServer.listen(METRICS_PORT, () => {
  logger.info(`Metrics API        → http://localhost:${METRICS_PORT}/metrics`);
  logger.info(`Open dashboard.html in your browser to see live charts`);
});
