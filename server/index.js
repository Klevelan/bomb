'use strict';
// Bomb Room multiplayer server.
// Serves the web app from /public and runs every online match on the server (authoritative),
// so all players see the same game. Clients only send inputs; the server sends back game state.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Game = require('../public/game.js');
const Cosmetics = require('../public/cosmetics.js');
const Ranks = require('../public/ranks.js');
const { createStore } = require('./store.js');

const store = createStore();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TICK_MS = 33;               // ~30 updates per second
const QUICK_START_MS = 10000;     // quick-match countdown once 2+ players are waiting
const DROP_AFTER_MS = 60000;      // disconnected players are removed from a lobby after this
const EMPTY_ROOM_MS = 120000;     // rooms with nobody connected are deleted after this
const MAX_ROOMS = 500;
const MAX_MEMBERS = 8;            // 4 players + spectators
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ------------------------------------------------------------------ */
/* Static file server                                                  */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendFile(res, ext, data) {
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(data);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { res.writeHead(400); res.end(); return; }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok ${rooms.size} rooms`);
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (!err) return sendFile(res, path.extname(file), data);
    if (path.extname(rel)) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
      if (e2) { res.writeHead(500); res.end(); return; }
      sendFile(res, '.html', d2);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

const rooms = new Map();   // code -> room
const clients = new Map(); // clientId -> { ws, roomCode }

const now = () => performance.now();

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return s || 'Player';
}

// Each device has a secret id (kept on the phone, used to reconnect and to own a ranking).
// Other players only ever see this one-way scrambled version of it.
const publicId = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);

function cleanLook(look) {
  const l = look && typeof look === 'object' ? look : {};
  return {
    skin: Cosmetics.valid('skin', l.skin) ? l.skin : 'classic',
    bomb: Cosmetics.valid('bomb', l.bomb) ? l.bomb : 'classic',
  };
}
const randomSkin = () => Cosmetics.SKINS[crypto.randomInt(Cosmetics.SKINS.length)].id;

function newCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(quick) {
  const room = {
    code: newCode(), quick, hostId: null, members: new Map(),
    difficulty: 'medium', fillBots: true, layout: 'random',
    phase: 'lobby', game: null, lastTick: 0,
    autoStartAt: null, emptySince: null,
  };
  rooms.set(room.code, room);
  return room;
}

const connectedMembers = (room) => [...room.members.values()].filter((m) => m.connected);

function roomInfo(room) {
  return {
    type: 'room',
    code: room.code,
    quick: room.quick,
    phase: room.phase,
    hostId: room.hostId ? publicId(room.hostId) : null,
    difficulty: room.difficulty,
    fillBots: room.fillBots,
    layout: room.layout,
    ranked: !!room.ranked,
    maxPlayers: Game.MAX_PLAYERS,
    autoStartIn: room.autoStartAt ? Math.max(0, Math.ceil((room.autoStartAt - now()) / 1000)) : null,
    members: [...room.members.values()].map((m) => ({
      id: m.pid, name: m.name, connected: m.connected, seat: m.seat,
    })),
  };
}

function broadcastRoom(room) {
  const msg = JSON.stringify(roomInfo(room));
  for (const m of room.members.values()) if (m.connected) send(m.ws, msg);
}

function pickNewHost(room) {
  const next = connectedMembers(room)[0] || room.members.values().next().value;
  room.hostId = next ? next.id : null;
}

function updateQuick(room) {
  if (!room.quick || room.phase !== 'lobby') return;
  const n = connectedMembers(room).length;
  if (n >= Game.MAX_PLAYERS) startRound(room);
  else if (n >= 2) { if (!room.autoStartAt) room.autoStartAt = now() + QUICK_START_MS; }
  else room.autoStartAt = null;
}

function addMember(room, id, name, ws) {
  let m = room.members.get(id);
  if (!m) {
    m = { id, pid: publicId(id), name, ws, connected: true, disconnectedAt: null, seat: null, sentGrid: null, look: ws.look || cleanLook() };
    room.members.set(id, m);
  } else {
    Object.assign(m, { name, ws, connected: true, disconnectedAt: null, sentGrid: null, look: ws.look || m.look });
  }
  if (!room.hostId || !room.members.has(room.hostId)) room.hostId = id;
  const c = clients.get(id);
  if (c) c.roomCode = room.code;
  updateQuick(room);
  broadcastRoom(room);
  if (room.phase === 'playing') send(ws, { type: 'notice', text: 'Match in progress. You will play next round.' });
}

function removeMember(room, id) {
  const m = room.members.get(id);
  if (!m) return;
  if (room.game && room.phase === 'playing' && m.seat !== null) Game.forfeit(room.game, m.seat, now());
  room.members.delete(id);
  const c = clients.get(id);
  if (c && c.roomCode === room.code) c.roomCode = null;
  if (room.members.size === 0) { rooms.delete(room.code); return; }
  if (room.hostId === id) pickNewHost(room);
  updateQuick(room);
  broadcastRoom(room);
}

function leaveCurrent(id) {
  const c = clients.get(id);
  if (!c || !c.roomCode) return;
  const room = rooms.get(c.roomCode);
  c.roomCode = null;
  if (room) removeMember(room, id);
}

function startRound(room) {
  const humans = connectedMembers(room).slice(0, Game.MAX_PLAYERS);
  const seats = humans.map((m) => ({ name: m.name, isBot: false, skin: m.look.skin, bomb: m.look.bomb }));
  if (room.fillBots) {
    let n = 1;
    while (seats.length < Game.MAX_PLAYERS) seats.push({ name: `Bot ${n++}`, isBot: true, skin: randomSkin() });
  }
  if (seats.length < 2) return 'Need at least 2 players, or turn on bots.';
  for (const m of room.members.values()) { m.seat = null; m.sentGrid = null; }
  humans.forEach((m, i) => { m.seat = i; });
  const t = now();
  room.game = Game.createGame({ mode: 'online', difficulty: room.difficulty, layout: room.layout, seats, now: t });
  // Ranked when at least two real people play. Remember who sat where, even if they leave.
  room.seatIds = humans.map((m) => m.id);
  room.ranked = humans.length >= 2;
  room.phase = 'playing';
  room.round = (room.round || 0) + 1;
  room.lastTick = t;
  room.autoStartAt = null;
  broadcastRoom(room);
  return null;
}

function findQuickRoom() {
  let best = null;
  for (const room of rooms.values()) {
    if (!room.quick || room.phase !== 'lobby') continue;
    const n = connectedMembers(room).length;
    if (n >= Game.MAX_PLAYERS) continue;
    if (!best || n > connectedMembers(best).length) best = room;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Messages from clients                                               */
/* ------------------------------------------------------------------ */

function currentRoom(ws) {
  const c = clients.get(ws.clientId);
  return c && c.roomCode ? rooms.get(c.roomCode) : null;
}

function handle(ws, msg) {
  if (msg.type === 'hello') {
    const id = typeof msg.id === 'string' && /^[\w-]{8,64}$/.test(msg.id) ? msg.id : crypto.randomUUID();
    ws.clientId = id;
    ws.name = cleanName(msg.name);
    ws.look = cleanLook(msg.look);
    const prev = clients.get(id);
    if (prev && prev.ws && prev.ws !== ws) { prev.ws.replaced = true; prev.ws.close(4000, 'replaced'); }
    clients.set(id, { ws, roomCode: prev ? prev.roomCode : null });
    send(ws, { type: 'welcome', pid: publicId(id) });
    sendMyRank(ws);
    // Reconnect: put the player back into their room and seat.
    const room = prev && prev.roomCode ? rooms.get(prev.roomCode) : null;
    if (room && room.members.has(id)) addMember(room, id, room.members.get(id).name, ws);
    return;
  }
  if (!ws.clientId) return;
  const id = ws.clientId;
  const room = currentRoom(ws);
  const member = room ? room.members.get(id) : null;
  const isHost = room && room.hostId === id;

  switch (msg.type) {
    case 'name':
      ws.name = cleanName(msg.name);
      if (member && room.phase !== 'playing') { member.name = ws.name; broadcastRoom(room); }
      break;

    case 'look':
      ws.look = cleanLook(msg);
      if (member) member.look = ws.look; // used from the next round
      break;

    case 'create': {
      leaveCurrent(id);
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', text: 'Server is full, try again soon.' });
      const r = createRoom(false);
      if (Game.DIFF[msg.difficulty]) r.difficulty = msg.difficulty;
      if (Game.LAYOUTS[msg.layout]) r.layout = msg.layout;
      addMember(r, id, cleanName(msg.name || ws.name), ws);
      break;
    }

    case 'join': {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const r = rooms.get(code);
      if (!r) return send(ws, { type: 'error', text: `Room ${code || '?'} not found.` });
      if (r === room) return broadcastRoom(r);
      if (r.members.size >= MAX_MEMBERS) return send(ws, { type: 'error', text: 'That room is full.' });
      leaveCurrent(id);
      addMember(r, id, cleanName(msg.name || ws.name), ws);
      break;
    }

    case 'quick': {
      leaveCurrent(id);
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', text: 'Server is full, try again soon.' });
      const r = findQuickRoom() || createRoom(true);
      addMember(r, id, cleanName(msg.name || ws.name), ws);
      break;
    }

    case 'leave':
      leaveCurrent(id);
      send(ws, { type: 'left' });
      break;

    case 'settings':
      if (!isHost || room.phase === 'playing') return;
      if (Game.DIFF[msg.difficulty]) room.difficulty = msg.difficulty;
      if (typeof msg.fillBots === 'boolean') room.fillBots = msg.fillBots;
      if (msg.layout === 'random' || Game.LAYOUTS[msg.layout]) room.layout = msg.layout;
      broadcastRoom(room);
      break;

    case 'start': {
      if (!isHost || room.phase === 'playing') return;
      const err = startRound(room);
      if (err) send(ws, { type: 'error', text: err });
      break;
    }

    case 'lobby':
      if (!isHost || room.phase !== 'results') return;
      room.phase = 'lobby';
      room.game = null;
      for (const m of room.members.values()) m.seat = null;
      updateQuick(room);
      broadcastRoom(room);
      break;

    case 'leaderboard':
      sendLeaderboard(ws);
      break;

    case 'input':
      if (room && room.phase === 'playing' && member && member.seat !== null) {
        const dir = Game.DIRS[msg.dir] ? msg.dir : null;
        room.game.players[member.seat].input = dir;
      }
      break;

    case 'bomb':
      if (room && room.phase === 'playing' && member && member.seat !== null) {
        Game.placeBomb(room.game, room.game.players[member.seat]);
      }
      break;
  }
}

function onClose(ws) {
  if (ws.replaced || !ws.clientId) return;
  const c = clients.get(ws.clientId);
  if (!c || c.ws !== ws) return;
  c.ws = null;
  const room = c.roomCode ? rooms.get(c.roomCode) : null;
  const m = room && room.members.get(ws.clientId);
  if (!m) return;
  m.connected = false;
  m.ws = null;
  m.disconnectedAt = now();
  if (room.game && m.seat !== null && room.phase === 'playing') room.game.players[m.seat].input = null;
  if (room.hostId === m.id && connectedMembers(room).length) pickNewHost(room);
  if (room.quick && room.phase === 'lobby') { room.autoStartAt = null; updateQuick(room); }
  broadcastRoom(room);
}

/* ------------------------------------------------------------------ */
/* Rankings                                                            */
/* ------------------------------------------------------------------ */

async function recordRanked(room, G, round) {
  const place = Game.placements(G);
  const seats = room.seatIds.map((id, seat) => ({
    id, seat, name: G.players[seat].name, kills: G.players[seat].kills, place: place[seat],
  }));
  const existing = await store.get(seats.map((s) => s.id));
  for (const s of seats) s.rating = existing[s.id] ? existing[s.id].rating : Ranks.START_RATING;
  const deltas = Ranks.rateMatch(seats);
  const results = seats.map((s, i) => ({
    id: s.id, name: s.name, kills: s.kills, won: G.winner === s.seat, rating: s.rating + deltas[i], delta: deltas[i],
  }));
  await store.save(results);
  for (const r of results) {
    const c = clients.get(r.id);
    if (!c || !c.ws) continue;
    const position = await store.position(r.rating);
    send(c.ws, { type: 'ranked', code: room.code, round, delta: r.delta, rating: r.rating, position });
  }
}

async function sendMyRank(ws) {
  try {
    const id = ws.clientId;
    const row = (await store.get([id]))[id];
    if (!row) { send(ws, { type: 'me', rating: null, matches: 0, wins: 0 }); return; }
    const position = await store.position(row.rating);
    send(ws, { type: 'me', rating: row.rating, matches: row.matches, wins: row.wins, position });
  } catch (e) {
    console.error('Could not load player rank:', e.message);
  }
}

async function sendLeaderboard(ws) {
  try {
    const [top, total] = await Promise.all([store.top(50), store.count()]);
    const rows = top.map((r) => ({ name: r.name, rating: r.rating, wins: r.wins, matches: r.matches, me: r.id === ws.clientId }));
    send(ws, { type: 'leaderboard', top: rows, total, saved: store.kind !== 'memory' });
    sendMyRank(ws);
  } catch (e) {
    console.error('Could not load leaderboard:', e.message);
    send(ws, { type: 'leaderboard', error: 'The leaderboard is unavailable right now.' });
  }
}

/* ------------------------------------------------------------------ */
/* WebSocket server                                                    */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.clientId = null;
  ws.msgCount = 0;
  ws.msgWindow = now();
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    const t = now();
    if (t - ws.msgWindow > 1000) { ws.msgWindow = t; ws.msgCount = 0; }
    if (++ws.msgCount > 60) return; // simple flood protection
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    try { handle(ws, msg); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => onClose(ws));
  ws.on('error', () => {});
});

// Heartbeat: drop dead connections (phones going to sleep, lost Wi-Fi).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

/* ------------------------------------------------------------------ */
/* Game loop and housekeeping                                          */
/* ------------------------------------------------------------------ */

setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    if (room.phase === 'lobby' && room.autoStartAt && t >= room.autoStartAt) startRound(room);
    if (room.phase !== 'playing') continue;

    const G = room.game;
    const dt = Math.min(100, t - room.lastTick);
    room.lastTick = t;
    Game.step(G, dt, t);

    const snap = Game.snapshot(G, t);
    const grid = Game.gridString(G);
    for (const m of room.members.values()) {
      if (!m.connected) continue;
      const msg = { type: 'state', ...snap, round: room.round, you: m.seat };
      if (m.sentGrid !== grid) { msg.grid = grid; m.sentGrid = grid; }
      send(m.ws, msg);
    }
    if (G.status === 'over') {
      room.phase = 'results';
      broadcastRoom(room);
      if (room.ranked) recordRanked(room, G, room.round).catch((e) => console.error('Could not save ranked result:', e.message));
    }
  }
}, TICK_MS);

setInterval(() => {
  const t = now();
  for (const room of [...rooms.values()]) {
    if (room.phase !== 'playing') {
      for (const m of [...room.members.values()]) {
        if (!m.connected && t - m.disconnectedAt > DROP_AFTER_MS) removeMember(room, m.id);
      }
    }
    if (!rooms.has(room.code)) continue;
    if (connectedMembers(room).length === 0) {
      room.emptySince = room.emptySince || t;
      if (t - room.emptySince > EMPTY_ROOM_MS) rooms.delete(room.code);
    } else {
      room.emptySince = null;
    }
    if (room.autoStartAt) broadcastRoom(room); // countdown ticks
  }
  for (const [id, c] of clients) {
    if (!c.ws && (!c.roomCode || !rooms.has(c.roomCode))) clients.delete(id);
  }
}, 1000);

store.init()
  .then(() => console.log(`Leaderboard storage: ${store.kind}`))
  .catch((e) => console.error('Could not set up the leaderboard database:', e.message));

server.listen(PORT, () => {
  console.log(`Bomb Room running on http://localhost:${PORT}`);
});
