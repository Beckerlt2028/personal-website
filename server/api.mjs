import { HttpError, members } from './auth.mjs';
import { newGame, joinGame, takeTurn, gameView } from './game.mjs';
export const json = (data, status = 200) => Response.json(data, { status });
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Missing request.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 40000) { await reader.cancel(); throw new HttpError(413, 'This message is too long.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const result = JSON.parse(new TextDecoder().decode(bytes)); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; }
  catch { throw new HttpError(400, 'Invalid request.'); }
}
function checkOrigin(request) {
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'Please use this space directly to make changes.');
  }
}
export async function api(request, env, me) {
  checkOrigin(request);
  const pathname = new URL(request.url).pathname.replace(/\/$/, '');
  const other = members(env).find(email => email !== me);
  if (pathname === '/us/api/me' && request.method === 'GET') return json({ me, other });
  if (!env.US_DB) throw new HttpError(503, 'Shared storage is not connected yet.');
  const db = env.US_DB;
  if (pathname === '/us/api/letters') {
    if (request.method === 'GET') {
      const { results } = await db.prepare(`SELECT id, title, author, recipient, status, opened_at, created_at, version FROM letters
        WHERE author = ? OR (recipient = ? AND status = 'shared') ORDER BY created_at DESC`).bind(me, me).all();
      return json({ letters: results });
    }
    if (request.method === 'POST') {
      const input = await body(request);
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const text = typeof input.body === 'string' ? input.body.trim() : '';
      if (!title || title.length > 100 || !text || text.length > 8000 || !['draft', 'shared'].includes(input.status)) {
        throw new HttpError(400, 'Add a title (up to 100 characters) and a letter (up to 8,000 characters).');
      }
      if (input.id) {
        const updated = await db.prepare(`UPDATE letters SET title = ?, body = ?, status = ?, version = version + 1
          WHERE id = ? AND author = ? AND version = ? AND status = 'draft'`).bind(title, text, input.status, input.id, me, input.version).run();
        if (!updated.meta.changes) throw new HttpError(409, 'This draft changed or has already been shared. Reopen it before editing.');
        return json({ id: input.id });
      }
      const id = crypto.randomUUID();
      await db.prepare(`INSERT INTO letters (id, title, body, author, recipient, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, title, text, me, other, input.status, new Date().toISOString()).run();
      return json({ id }, 201);
    }
  }
  const match = pathname.match(/^\/us\/api\/letters\/([a-f0-9-]{36})$/);
  if (match && request.method === 'GET') {
    const letter = await db.prepare(`SELECT * FROM letters WHERE id = ? AND (author = ? OR (recipient = ? AND status = 'shared'))`)
      .bind(match[1], me, me).first();
    if (!letter) throw new HttpError(404, 'This letter is not available.');
    return json(letter);
  }
  const openMatch = pathname.match(/^\/us\/api\/letters\/([a-f0-9-]{36})\/open$/);
  if (openMatch && request.method === 'POST') {
    await db.prepare(`UPDATE letters SET opened_at = COALESCE(opened_at, ?) WHERE id = ? AND recipient = ? AND status = 'shared'`)
      .bind(new Date().toISOString(), openMatch[1], me).run();
    return json({ ok: true });
  }
  if (pathname === '/us/api/game') {
    const row = await db.prepare('SELECT state, version FROM games WHERE id = 1').first();
    const state = row ? JSON.parse(row.state) : null;
    if (request.method === 'GET') return json({ game: state ? gameView(state, me, row.version) : null });
    if (request.method === 'POST') {
      const input = await body(request);
      let next;
      try {
        if (input.action === 'new') {
          if (state && state.status !== 'finished') throw new HttpError(409, 'There is already a game at this table.');
          next = newGame(me);
        } else {
          if (!state) throw new HttpError(409, 'Start a game first.');
          if (input.version !== row.version) throw new HttpError(409, 'The table changed. Refresh it before taking a turn.');
          next = input.action === 'join' ? joinGame(state, me) : takeTurn(state, me, input.action, input.board);
        }
      } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, error.message); }
      if (!row) {
        const inserted = await db.prepare('INSERT OR IGNORE INTO games (id, state, version) VALUES (1, ?, 1)').bind(JSON.stringify(next)).run();
        if (!inserted.meta.changes) throw new HttpError(409, 'A game was just started. Refresh the table.');
      } else {
        const updated = await db.prepare('UPDATE games SET state = ?, version = version + 1 WHERE id = 1 AND version = ?')
          .bind(JSON.stringify(next), row.version).run();
        if (!updated.meta.changes) throw new HttpError(409, 'The table changed. Refresh it before taking a turn.');
      }
      return json({ game: gameView(next, me, (row?.version || 0) + 1) });
    }
  }
  throw new HttpError(404, 'Not found.');
}
