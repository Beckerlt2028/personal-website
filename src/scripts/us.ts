import { tile, validSet } from '../../server/game.mjs';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => el<HTMLButtonElement>(id);
const notice = (message = '') => { el('notice').textContent = message; };
let me = '', other = '', folder = 'inbox', letters: any[] = [], editing: any = null, reading: any = null;
let game: any = null, draft: string[][] = [], selected = new Set<string>(), dirty = false, busy = false, sortByNumber = false, ready = false;
async function request(path: string, data?: unknown) {
  const response = await fetch(`/us/api/${path}`, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error' });
  let result: any;
  try { result = await response.json(); } catch { throw new Error('Our space could not connect. Reload the page to sign in again.'); }
  if (!response.ok) throw new Error(result.error || 'Please try again.');
  return result;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Could not connect. Please try again.'; }
function showTab(name: 'letters' | 'games') {
  for (const tab of ['letters', 'games']) {
    const active = tab === name;
    button(`${tab}-tab`).setAttribute('aria-selected', String(active));
    button(`${tab}-tab`).tabIndex = active ? 0 : -1;
    el(`${tab}-panel`).hidden = !active;
  }
  if (name === 'games' && ready) void refreshGame();
}
for (const name of ['letters', 'games'] as const) {
  button(`${name}-tab`).onclick = () => showTab(name);
  button(`${name}-tab`).onkeydown = e => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const next = e.key === 'Home' ? 'letters' : e.key === 'End' ? 'games' : name === 'letters' ? 'games' : 'letters';
      showTab(next); button(`${next}-tab`).focus();
    }
  };
}
function compose(title = '', letter: any = null) {
  editing = letter;
  el<HTMLInputElement>('letter-title').value = letter?.title || title;
  el<HTMLTextAreaElement>('letter-body').value = letter?.body || '';
  el('save-error').textContent = '';
  el<HTMLDialogElement>('composer').showModal();
}
function closeComposer() {
  const changed = el<HTMLInputElement>('letter-title').value !== (editing?.title || '') || el<HTMLTextAreaElement>('letter-body').value !== (editing?.body || '');
  if (!changed || confirm('Close without saving these changes?')) el<HTMLDialogElement>('composer').close();
}
button('compose').onclick = () => compose();
document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(b => b.onclick = () => compose(b.dataset.prompt));
button('close-composer').onclick = closeComposer;
el<HTMLDialogElement>('composer').addEventListener('cancel', e => { e.preventDefault(); closeComposer(); });
button('close-reader').onclick = () => el<HTMLDialogElement>('reader').close();
button('edit-draft').onclick = () => { el<HTMLDialogElement>('reader').close(); compose('', reading); };
el<HTMLFormElement>('letter-form').onsubmit = async e => {
  e.preventDefault();
  const status = (e.submitter as HTMLButtonElement)?.value || 'draft';
  const buttons = el('letter-form').querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach(b => b.disabled = true);
  try {
    await request('letters', { id: editing?.id, version: editing?.version, title: el<HTMLInputElement>('letter-title').value,
      body: el<HTMLTextAreaElement>('letter-body').value, status });
    el<HTMLDialogElement>('composer').close();
    folder = 'outbox'; await loadLetters();
    notice(status === 'shared' ? 'Sealed and waiting for your person.' : 'Draft saved. Come back whenever the words do.');
  } catch (error) { el('save-error').textContent = errorMessage(error); }
  finally { buttons.forEach(b => b.disabled = false); }
};
function span(className: string, content: string) { const s = document.createElement('span'); s.className = className; s.textContent = content; return s; }
async function openLetter(id: string) {
  try {
    reading = await request(`letters/${id}`);
    el('reader-title').textContent = `Open when ${reading.title}`;
    el('reader-body').textContent = reading.body;
    el('reader-from').textContent = reading.author === me ? 'Written by you' : 'From your person, with love.';
    button('edit-draft').hidden = !(reading.author === me && reading.status === 'draft');
    el<HTMLDialogElement>('reader').showModal();
    if (reading.recipient === me) { await request(`letters/${id}/open`, {}); await loadLetters(); }
  } catch (error) { notice(errorMessage(error)); }
}
function renderLetters() {
  button('inbox-filter').setAttribute('aria-pressed', String(folder === 'inbox'));
  button('outbox-filter').setAttribute('aria-pressed', String(folder === 'outbox'));
  const visible = letters.filter(l => folder === 'inbox' ? l.recipient === me : l.author === me);
  el('letters').replaceChildren();
  el('letter-empty').hidden = visible.length > 0;
  el('empty-title').textContent = folder === 'inbox' ? 'Something to look forward to.' : 'A few words can travel a long way.';
  el('empty-copy').textContent = folder === 'inbox' ? 'Letters shared with you will be waiting here, ready for the right moment.' : 'Write your first letter, save it for later, or seal it for your person.';
  for (const letter of visible) {
    const card = document.createElement('button'); card.className = 'letter-card';
    const meta = span('card-meta', letter.status === 'draft' ? 'Only you · draft' : letter.opened_at ? 'Opened, and kept' : 'Sealed with love');
    const heart = span('card-stamp', '♡'); heart.setAttribute('aria-hidden', 'true'); meta.append(heart);
    card.append(meta, span('card-prefix', 'Open when…'), span('card-title', letter.title), span('card-bottom', folder === 'inbox' ? 'A little piece of us' : letter.status === 'draft' ? 'Keep writing' : 'Waiting in their letter box'));
    card.onclick = () => void openLetter(letter.id); el('letters').append(card);
  }
}
async function loadLetters() { letters = (await request('letters')).letters; renderLetters(); }
button('inbox-filter').onclick = () => { folder = 'inbox'; renderLetters(); };
button('outbox-filter').onclick = () => { folder = 'outbox'; renderLetters(); };
function myTurn() { return game?.status === 'playing' && game.turn === me && !busy; }
function adopt(next: any) { game = next; draft = structuredClone(game?.board || []); selected.clear(); dirty = false; renderGame(); }
async function refreshGame(manual = false) {
  if (busy || (dirty && !manual)) return;
  if (dirty && manual && !confirm('Refresh the table and discard your unfinished rearrangement?')) return;
  try { const result = await request('game'); if (!game || result.game?.version !== game.version || manual) adopt(result.game); }
  catch (error) { notice(errorMessage(error)); }
}
async function action(actionName: string) {
  busy = true; renderGame();
  try { const result = await request('game', { action: actionName, version: game?.version, board: draft }); adopt(result.game); notice(); }
  catch (error) { notice(errorMessage(error)); }
  finally { busy = false; renderGame(); }
}
function tileButton(id: string) {
  const t = tile(id)!; const b = document.createElement('button'); b.className = 'tile'; b.dataset.color = t.color;
  b.dataset.tileId = id;
  b.setAttribute('aria-label', `${t.color} ${t.value}`); b.setAttribute('aria-pressed', String(selected.has(id)));
  b.append(span('', String(t.value))); const small = document.createElement('small'); small.textContent = t.color; b.append(small);
  b.disabled = !myTurn(); b.onclick = () => { if (selected.has(id)) selected.delete(id); else selected.add(id); renderGame(); };
  return b;
}
function moveTo(index: number) {
  if (!selected.size || !myTurn()) return;
  const moved = [...selected];
  draft = draft.map(group => group.filter(id => !selected.has(id)));
  if (index < 0) draft.push(moved); else draft[index].push(...moved);
  draft = draft.filter(group => group.length);
  selected.clear(); dirty = true; renderGame();
}
function renderGame() {
  const focusedTile = (document.activeElement as HTMLElement)?.dataset?.tileId;
  button('start-game').hidden = !!game && game.status !== 'finished';
  button('start-game').disabled = busy || !ready;
  button('start-game').textContent = game?.status === 'finished' ? 'Play again' : 'Start a game';
  button('join-game').hidden = !(game?.status === 'waiting' && !game.players.includes(me));
  button('join-game').disabled = busy;
  el('game-surface').hidden = !game || !game.players.includes(me);
  el('game-status').textContent = !game ? 'Pull up a chair. Your next game starts here.' : game.status === 'waiting' ? game.players.includes(me) ? 'Your seat is saved. Waiting for your person to join.' : 'Your person saved you a seat.' : game.status === 'finished' ? game.winner === me ? 'You won. Time for a rematch?' : game.winner ? 'Your person won this one. Rematch?' : 'A tie. That calls for another game.' : game.turn === me ? game.opened[me] ? 'Your turn. Make a little room on your rack.' : 'Your turn. Start with at least 30 points.' : 'Their turn. Your tiles will be here when you’re back.';
  if (!game) return;
  el('opponent-count').textContent = game.players.includes(other) ? `Your person · ${game.counts[other]} tiles` : 'A seat for your person';
  el('pile-count').textContent = `${game.remaining} tiles in the pile`;
  el('board').replaceChildren();
  if (!draft.length) { const p = document.createElement('p'); p.className = 'board-empty'; p.textContent = 'A whole table of possibilities.'; el('board').append(p); }
  draft.forEach((group, i) => {
    const set = document.createElement('div'); set.className = `tile-group${validSet(group) ? '' : ' invalid'}`;
    set.setAttribute('role', 'group'); set.setAttribute('aria-label', `Set ${i + 1}${validSet(group) ? '' : ', unfinished'}`);
    group.forEach(id => set.append(tileButton(id)));
    if (myTurn()) { const move = document.createElement('button'); move.className = 'place-here'; move.textContent = 'Move here'; move.setAttribute('aria-label', `Move selected tiles to set ${i + 1}`); move.disabled = selected.size === 0; move.onclick = () => moveTo(i); set.append(move); }
    el('board').append(set);
  });
  const placed = new Set(draft.flat());
  const pool = [...game.hand, ...game.board.flat()].filter(id => !placed.has(id));
  pool.sort((a, b) => { const x = tile(a)!, y = tile(b)!; return sortByNumber ? x.value - y.value || x.color.localeCompare(y.color) : x.color.localeCompare(y.color) || x.value - y.value; });
  el('rack').replaceChildren(...pool.map(tileButton));
  el('rack-count').textContent = `· ${pool.length} tiles here`;
  el('selection-count').textContent = selected.size ? `${selected.size} selected` : dirty ? 'Your changes haven’t been played yet.' : 'Your turn saves when you finish it.';
  button('new-set').disabled = !myTurn() || !selected.size;
  button('reset-turn').disabled = !myTurn() || (!dirty && !selected.size);
  button('play-turn').disabled = !myTurn() || !dirty;
  button('draw-tile').disabled = !myTurn();
  button('draw-tile').textContent = game.remaining ? 'Draw & end turn' : 'Pass my turn';
  if (focusedTile) document.querySelector<HTMLButtonElement>(`[data-tile-id="${focusedTile}"]`)?.focus({ preventScroll: true });
}
button('new-set').onclick = () => moveTo(-1);
button('reset-turn').onclick = () => adopt(game);
button('sort-rack').onclick = () => { sortByNumber = !sortByNumber; button('sort-rack').textContent = sortByNumber ? 'Sort by color' : 'Sort by number'; renderGame(); };
button('play-turn').onclick = () => void action('play');
button('draw-tile').onclick = () => { if (!dirty || confirm('Discard this rearrangement, draw a tile, and end your turn?')) void action('draw'); };
button('start-game').onclick = () => void action('new');
button('join-game').onclick = () => void action('join');
button('refresh-game').onclick = () => void refreshGame(true);
window.addEventListener('beforeunload', e => { if (dirty || el<HTMLDialogElement>('composer').open) { e.preventDefault(); e.returnValue = ''; } });
async function init() {
  try {
    const identity = await request('me'); me = identity.me; other = identity.other;
    if (identity.passwordSignIn) el('sign-out').onclick = async event => {
      event.preventDefault();
      if ((dirty || el<HTMLDialogElement>('composer').open) && !confirm('Sign out and discard your unsaved changes?')) return;
      try {
        const response = await fetch('/us/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!response.ok) throw new Error('Could not sign out. Please try again.');
        dirty = false; el<HTMLDialogElement>('composer').close(); window.location.replace('/us/login/');
      } catch (error) { notice(errorMessage(error)); }
    };
    if (identity.preview) { el('sign-out').hidden = true; el('preview-banner').hidden = false; el<HTMLAnchorElement>('preview-switch').href = `?previewPerson=${identity.previewPerson === 'you' ? 'other' : 'you'}`; el('preview-switch').textContent = identity.previewPerson === 'you' ? 'Preview as your person' : 'Preview as you'; }
    await loadLetters(); ready = true;
    button('compose').disabled = false; button('refresh-game').disabled = false;
    document.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(b => b.disabled = false);
    notice(); await refreshGame();
  } catch (error) {
    notice(errorMessage(error));
    const retry = document.createElement('a'); retry.href = '/us/'; retry.textContent = 'Reload & sign in'; el('notice').append(retry);
    el('game-status').textContent = 'The table will open once our space is connected.';
  }
}
setInterval(() => { if (!document.hidden && ready && !el('games-panel').hidden) void refreshGame(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ready) { void loadLetters().catch(e => notice(errorMessage(e))); void refreshGame(); } });
void init();
