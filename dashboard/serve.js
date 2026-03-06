'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'dashboard.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error loading dashboard'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`[dashboard] Serving on port ${PORT}`));