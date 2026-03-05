'use strict';

const http = require('http');

// ── CLI Arguments 
const [, , SERVER_ID, PORT_ARG] = process.argv;

if (!SERVER_ID || !PORT_ARG) {
    console.error('Usage: node server.js <server_id> <port>');
    console.error('Example: node server.js server-1 5001');
    process.exit(1);
}

const PORT = parseInt(PORT_ARG, 10);

if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`Invalid port: "${PORT_ARG}". Must be a number between 1 and 65535.`);
    process.exit(1);
}

// ── Logger 
function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${SERVER_ID}] ${message}`);
}

// ── Request Handler 
function handleRequest(req, res) {
    const timestamp = new Date().toISOString();

    // Log every incoming request
    log(`${req.method} ${req.url} — from ${req.socket.remoteAddress}`);

    // Build the JSON response payload
    const payload = {
        server_id: SERVER_ID,
        timestamp,
        message: 'request handled',
    };

    const body = JSON.stringify(payload, null, 2);

    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Served-By': SERVER_ID,
    });

    res.end(body);
}

// ── Server Setup 
const server = http.createServer(handleRequest);

// Graceful shutdown
function shutdown(signal) {
    log(`Received ${signal}. Shutting down gracefully…`);
    server.close(() => {
        log('Server closed.');
        process.exit(0);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start listening
server.listen(PORT, () => {
    log(`Server started and listening on port ${PORT}`);
});