import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const host = process.env.UI_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.UI_PORT || '5070', 10);
const root = path.resolve('frontend');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const resolvePath = (urlPath) => {
  const clean = String(urlPath || '/').split('?')[0].split('#')[0];
  const rel = clean === '/' ? '/index.html' : clean;
  const full = path.resolve(root, `.${rel}`);
  if (!full.startsWith(root)) return null;
  return full;
};

const server = http.createServer((req, res) => {
  const filePath = resolvePath(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': mime[ext] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`InterSplit UI running at http://${host}:${port}`);
  console.log('Open this URL in your browser while Intercom runs with --sc-bridge 1.');
});
