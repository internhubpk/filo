// =============================================================================
// Minimal S3-compatible storage mock for artifact-pipeline E2E tests.
// Implements path-style PUT / GET / HEAD / DELETE /{bucket}/{key}.
// Signature verification is intentionally omitted (local testing only).
// =============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.MOCK_S3_PORT || 9402);
const ROOT = process.env.MOCK_S3_ROOT || path.join(__dirname, '.storage');

function keyPath(bucket, key) {
  return path.join(ROOT, bucket, key);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/');
  const bucket = parts.shift();
  const key = parts.join('/');
  const file = keyPath(bucket, key);

  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"mock"' });
        res.end();
      } catch (e) {
        res.writeHead(500).end(String(e));
      }
    });
    return;
  }

  if (req.method === 'HEAD') {
    if (fs.existsSync(file)) {
      const st = fs.statSync(file);
      res.writeHead(200, { 'Content-Length': String(st.size), ETag: '"mock"' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  if (req.method === 'GET') {
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Length': String(buf.length), 'Content-Type': 'application/octet-stream' });
      res.end(buf);
    } else {
      res.writeHead(404).end('NoSuchKey');
    }
    return;
  }

  if (req.method === 'DELETE') {
    try { fs.rmSync(file, { force: true }); } catch {}
    res.writeHead(204).end();
    return;
  }

  res.writeHead(405).end();
});

server.listen(PORT, '127.0.0.1', () => console.log(`[mock-s3] listening on 127.0.0.1:${PORT}, root=${ROOT}`));
