// Local-only, disposable preview. Never imported by the production Worker.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { api, json } from '../server/api.mjs';
import { HttpError } from '../server/auth.mjs';
import { localDb } from './local-db.mjs';
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const env = { ACCESS_ALLOWED_EMAILS: 'you@example.test,partner@example.test', US_DB: localDb() };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.headers.host !== '127.0.0.1:4321') { outgoing.writeHead(403); outgoing.end(); return; }
    const url = new URL(incoming.url, 'http://127.0.0.1:4321');
    if (url.searchParams.has('previewPerson')) {
      const person = url.searchParams.get('previewPerson') === 'other' ? 'other' : 'you';
      outgoing.writeHead(303, { Location: '/us/', 'Set-Cookie': `preview_person=${person}; Path=/; HttpOnly; SameSite=Strict`, 'Cache-Control': 'no-store' }); outgoing.end(); return;
    }
    const person = /(?:^|;\s*)preview_person=other(?:;|$)/.test(incoming.headers.cookie || '') ? 'other' : 'you';
    const me = person === 'you' ? 'you@example.test' : 'partner@example.test';
    if (url.pathname.startsWith('/us/api/')) {
      const chunks = []; let total = 0;
      for await (const chunk of incoming) { total += chunk.length; if (total > 40000) throw new HttpError(413, 'Request too large.'); chunks.push(chunk); }
      const request = new Request(url, { method: incoming.method, headers: incoming.headers,
        body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Buffer.concat(chunks) });
      let response = await api(request, env, me);
      if (url.pathname === '/us/api/me') response = json({ ...await response.json(), preview: true, previewPerson: person });
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' }); outgoing.end(await response.text()); return;
    }
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (target !== root && !target.startsWith(root + path.sep)) throw new HttpError(403, 'Forbidden');
    let file = target;
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    outgoing.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    outgoing.end(await readFile(file));
  } catch (error) {
    outgoing.writeHead(error instanceof HttpError ? error.status : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    outgoing.end(JSON.stringify({ error: error instanceof HttpError ? error.message : 'Not found.' }));
  }
});
server.listen(4321, '127.0.0.1', () => console.log('Disposable preview: http://127.0.0.1:4321/us/'));
