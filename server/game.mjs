// A two-player tile-rummy variant: 104 numbered tiles, no jokers or turn timer.
export const COLORS = ['red', 'blue', 'gold', 'black'];
export const TILES = Object.freeze(COLORS.flatMap(color => Array.from({ length: 13 }, (_, i) =>
  [0, 1].map(copy => ({ id: `${color}-${i + 1}-${copy}`, color, value: i + 1 }))).flat()));
const byId = new Map(TILES.map(tile => [tile.id, tile]));
export const tile = id => byId.get(id);
function requireRule(ok, message) { if (!ok) throw new Error(message); }
export function validSet(ids) {
  if (!Array.isArray(ids) || ids.length < 3 || ids.length > 13) return false;
  const tiles = ids.map(tile);
  if (tiles.some(t => !t) || new Set(ids).size !== ids.length) return false;
  const group = tiles.length <= 4 && tiles.every(t => t.value === tiles[0].value)
    && new Set(tiles.map(t => t.color)).size === tiles.length;
  const values = tiles.map(t => t.value).sort((a, b) => a - b);
  const run = tiles.every(t => t.color === tiles[0].color)
    && values.every((v, i) => i === 0 || v === values[i - 1] + 1);
  return group || run;
}
export function newGame(player, random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) {
  const pile = TILES.map(t => t.id);
  for (let i = pile.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pile[i], pile[j]] = [pile[j], pile[i]];
  }
  return { players: [player], hands: { [player]: pile.splice(0, 14) }, pile, board: [],
    opened: { [player]: false }, turn: player, status: 'waiting', winner: null, passes: 0 };
}
export function joinGame(game, player) {
  requireRule(game.status === 'waiting' && !game.players.includes(player), 'This table already has its players.');
  const next = structuredClone(game);
  next.players.push(player);
  next.hands[player] = next.pile.splice(0, 14);
  next.opened[player] = false;
  next.status = 'playing';
  return next;
}
export function takeTurn(game, player, action, board) {
  requireRule(game.status === 'playing' && game.turn === player, 'Wait for your turn.');
  const next = structuredClone(game);
  if (action === 'draw') {
    if (next.pile.length) { next.hands[player].push(next.pile.pop()); next.passes = 0; }
    else next.passes++;
  } else {
    requireRule(action === 'play', 'Choose a valid action.');
    requireRule(Array.isArray(board) && board.length <= 35 && board.every(validSet), 'Every set needs at least 3 tiles: a run in one color, or one number in different colors.');
    const placed = board.flat();
    const before = game.board.flat();
    const allowed = new Set([...before, ...game.hands[player]]);
    requireRule(new Set(placed).size === placed.length && placed.every(id => allowed.has(id)), 'Use only tiles from your rack and the table, once each.');
    requireRule(before.every(id => placed.includes(id)), 'Put every tile from the table back into a valid set.');
    const added = placed.filter(id => !before.includes(id));
    requireRule(added.length > 0, 'Play at least one tile from your rack, or draw a tile.');
    if (!game.opened[player]) {
      const unchanged = game.board.every(group => board.some(g => g.length === group.length && group.every(id => g.includes(id))));
      requireRule(unchanged, 'Your first play must use only your rack. Leave the existing sets unchanged.');
      requireRule(added.reduce((sum, id) => sum + tile(id).value, 0) >= 30, 'Your first play needs at least 30 points from your own rack.');
      next.opened[player] = true;
    }
    next.board = board;
    next.hands[player] = next.hands[player].filter(id => !added.includes(id));
    next.passes = 0;
    if (!next.hands[player].length) { next.status = 'finished'; next.winner = player; }
  }
  if (next.passes >= 2) {
    const scores = next.players.map(p => next.hands[p].reduce((sum, id) => sum + tile(id).value, 0));
    next.status = 'finished';
    next.winner = scores[0] === scores[1] ? null : next.players[scores[0] < scores[1] ? 0 : 1];
  }
  next.turn = next.players.find(p => p !== player);
  return next;
}
export function gameView(game, player, version) {
  return { version, players: game.players, hand: game.hands[player] || [], board: game.board,
    counts: Object.fromEntries(game.players.map(p => [p, game.hands[p].length])),
    opened: game.opened, turn: game.turn, status: game.status, winner: game.winner, remaining: game.pile.length };
}
