import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadSettings, projectRoot } from './environment.mjs';
import { handleApi } from '../src/server/api.ts';

const directory = resolve(projectRoot, 'dist');
const settings = loadSettings();
const env = { TOMTOM_API_KEY: settings.TOMTOM_API_KEY };
const security = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1:8787');
    if (url.origin !== 'http://127.0.0.1:8787') {
      outgoing.writeHead(400, security); outgoing.end(); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const response = await handleApi(new Request(url, { method: incoming.method }), env, fetch, true);
      outgoing.writeHead(response.status, { ...security, ...Object.fromEntries(response.headers) });
      outgoing.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const path = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
    const fromRoot = relative(directory, path);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot) || pathname.split('/').some(part => part.startsWith('.'))) {
      outgoing.writeHead(404, security); outgoing.end('Not found'); return;
    }
    const data = await readFile(path);
    outgoing.writeHead(200, { ...security, 'Cache-Control': 'no-store',
      'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
    outgoing.end(incoming.method === 'HEAD' ? undefined : data);
  } catch {
    outgoing.writeHead(404, security); outgoing.end('Not found');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Port 8787 is already in use.' : 'Local preview could not start.');
  process.exitCode = 1;
});
server.listen(8787, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:8787 (server-side key; no public binding).'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
