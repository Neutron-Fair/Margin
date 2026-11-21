import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'dist');
const probesDir = path.join(__dirname, 'probes');
const PORT = Number(process.env.PORT || 5199);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

const readFileSafe = (file) => {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
};

http
  .createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');

    // 探针上报
    if (req.method === 'POST' && u.pathname === '/__report') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const suite = u.searchParams.get('suite') || 'default';
        fs.writeFileSync(path.join(__dirname, `probe-report-${suite}.json`), body);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('saved');
      });
      return;
    }

    // 探针页面：/__probe.html?suite=desktop
    if (u.pathname === '/__probe.html') {
      const suite = u.searchParams.get('suite') || 'desktop';
      const data = readFileSafe(path.join(probesDir, `${suite}.html`));
      res.writeHead(data ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data || 'probe not found');
      return;
    }

    // 仅供 OCR 探针使用：直接从 node_modules 取 UMD 库，不污染 dist
    if (u.pathname === '/__tesseract.js') {
      const data = readFileSafe(path.resolve(__dirname, '..', 'node_modules', 'tesseract.js', 'dist', 'tesseract.min.js'));
      res.writeHead(data ? 200 : 404, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(data || 'not found');
      return;
    }

    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const data = readFileSafe(file);
    if (!data) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`static server on http://127.0.0.1:${PORT}`));
