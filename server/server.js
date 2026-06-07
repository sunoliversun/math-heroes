// Math Heroes server: serves the static client and runs the real-time
// multiplayer game over WebSockets. Players join rooms with a shared 4-letter
// code and see each other move, solve puzzles, and climb the leaderboard live.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { RoomRegistry } from './gameState.js';
import * as store from './store.js';
import { SHOP_ITEMS, STAGES } from '../shared/config.js';

const TEACHER_PASSCODE = process.env.TEACHER_PASSCODE || 'teach1234';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// ---- Static file server -----------------------------------------------------
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let urlPath = decodeURIComponent(parsed.pathname);
  if (urlPath === '/') urlPath = '/index.html';

  // ---- Teacher/parent dashboard API (passcode-protected) ----
  if (urlPath === '/api/dashboard') {
    const pass = parsed.searchParams.get('pass') || '';
    if (pass !== TEACHER_PASSCODE) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Wrong passcode.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.dashboardData()));
    return;
  }
  if (urlPath === '/dashboard') urlPath = '/dashboard.html';

  // Allow the client to import shared/* modules directly.
  let baseDir = PUBLIC;
  if (urlPath.startsWith('/shared/')) {
    baseDir = ROOT;
  }

  // Prevent directory traversal.
  const resolved = path.normalize(path.join(baseDir, urlPath));
  const allowed = resolved.startsWith(PUBLIC) || resolved.startsWith(SHARED);
  if (!allowed) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  serveFile(res, resolved);
});

// ---- Real-time game ---------------------------------------------------------
const registry = new RoomRegistry();
const wss = new WebSocketServer({ server });

let nextId = 1;
const SHOP_BY_ID = new Map(SHOP_ITEMS.map(i => [i.id, i]));

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload, exceptId = null) {
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws) send(p.ws, type, payload);
  }
}

function attach(room, player, ws) {
  player.ws = ws;
  ws.roomCode = room.code;
  ws.playerId = player.id;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    const room = registry.getRoom(ws.roomCode);
    if (!room) return;
    const player = room.players.get(ws.playerId);
    if (player && player.username) {
      if (ws.loginAt) store.addPlaytime(player, Date.now() - ws.loginAt);
      store.syncFromPlayer(player);
    }
    if (ws.sessionId) store.endSession(ws.sessionId);
    room.removePlayer(ws.playerId);
    broadcast(room, 'playerLeft', { id: ws.playerId });
    if (room.isEmpty) registry.removeRoom(room.code);
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'auth': return onAuth(ws, msg);
    case 'create': return onCreate(ws, msg);
    case 'join': return onJoin(ws, msg);
    case 'move': return onMove(ws, msg);
    case 'requestPuzzle': return onRequestPuzzle(ws, msg);
    case 'answer': return onAnswer(ws, msg);
    case 'buy': return onBuy(ws, msg);
    case 'chat': return onChat(ws, msg);
    default: break;
  }
}

// Login or create a saved profile. Returns a session token the client passes
// to create/join so the player is restored with their coins & cosmetics.
function onAuth(ws, msg) {
  const result = msg.mode === 'register'
    ? store.register(msg.name, msg.pin)
    : store.login(msg.name, msg.pin);
  if (!result.ok) { send(ws, 'authError', { message: result.reason }); return; }
  ws.sessionId = result.sessionId;
  send(ws, 'authed', { sessionId: result.sessionId, profile: result.profile });
}

// If the connection authenticated, load their saved profile into the player.
function hydrateIfLoggedIn(ws, player) {
  const sessionId = ws.sessionId || null;
  if (!sessionId) return;
  const profile = store.profileForSession(sessionId);
  if (!profile) return;
  store.hydratePlayer(player, profile);
  player.name = profile.username; // play under the saved hero name
  ws.loginAt = Date.now();
}

function onCreate(ws, msg) {
  const room = registry.createRoom();
  const id = `p${nextId++}`;
  const player = room.addPlayer(id, msg.name, msg.hero);
  hydrateIfLoggedIn(ws, player);
  attach(room, player, ws);
  send(ws, 'joined', joinPayload(room, player));
  broadcastRoster(room);
}

function onJoin(ws, msg) {
  const room = registry.getRoom(msg.code);
  if (!room) { send(ws, 'error', { message: 'Room not found. Check the code!' }); return; }
  if (room.players.size >= 8) { send(ws, 'error', { message: 'Room is full (max 8 heroes).' }); return; }
  const id = `p${nextId++}`;
  const player = room.addPlayer(id, msg.name, msg.hero);
  hydrateIfLoggedIn(ws, player);
  attach(room, player, ws);
  send(ws, 'joined', joinPayload(room, player));
  broadcast(room, 'playerJoined', { player: publicOf(player) }, player.id);
  broadcastRoster(room);
}

function joinPayload(room, player) {
  return {
    roomCode: room.code,
    playerId: player.id,
    you: publicOf(player),
    stage: player.stageIndex,
    orbs: room.getOrbs(player.stageIndex),
    players: room.snapshot().players,
    adventure: room.adventure
  };
}

function publicOf(p) {
  return {
    id: p.id, name: p.name, hero: p.hero, stageIndex: p.stageIndex,
    points: p.points, totalScore: p.totalScore, coins: p.coins,
    pos: p.pos, cosmetics: p.cosmetics, trophies: p.trophies, streak: p.streak,
    owned: p.owned, perks: p.perks
  };
}

function onMove(ws, msg) {
  const room = registry.getRoom(ws.roomCode);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;
  if (msg.pos && typeof msg.pos.x === 'number') {
    player.pos = {
      x: clampNum(msg.pos.x), y: clampNum(msg.pos.y), z: clampNum(msg.pos.z),
      ry: clampNum(msg.pos.ry)
    };
  }
  broadcast(room, 'playerMoved', { id: player.id, pos: player.pos, stage: player.stageIndex }, player.id);
}

function clampNum(n) { return (typeof n === 'number' && isFinite(n)) ? n : 0; }

function onRequestPuzzle(ws, msg) {
  const room = registry.getRoom(ws.roomCode);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;
  const puzzle = room.puzzleFor(player, msg.orbId);
  if (!puzzle) { send(ws, 'puzzleUnavailable', { orbId: msg.orbId }); return; }
  // Hint perk: tell client to grey out one wrong choice.
  const hint = player.perks.includes('hint');
  // Never send the answer to the client.
  send(ws, 'puzzle', {
    orbId: msg.orbId,
    question: puzzle.question,
    choices: puzzle.choices,
    skill: puzzle.skill,
    hint,
    // for the hint, send the index of one wrong choice to grey out
    hintWrongIndex: hint ? firstWrongIndex(puzzle) : -1
  });
}

function firstWrongIndex(puzzle) {
  return puzzle.choices.findIndex(c => Number(c) !== Number(puzzle.answer));
}

function onAnswer(ws, msg) {
  const room = registry.getRoom(ws.roomCode);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;

  const result = room.submitAnswer(player, msg.orbId, msg.answer);
  if (!result.ok) { send(ws, 'answerResult', { ok: false, reason: result.reason }); return; }

  // Persist stats & progress for logged-in players.
  if (result.skill) store.recordAttempt(player, result.skill, result.correct);

  send(ws, 'answerResult', result);

  if (result.correct) {
    store.syncFromPlayer(player);
    // Tell everyone the orb is gone (so worlds stay in sync) and update scores.
    broadcast(room, 'orbCollected', { orbId: result.orbId, by: player.id, stage: player.stageIndex }, player.id);
    broadcastRoster(room);

    if (result.stageComplete) {
      if (result.trophy) {
        broadcast(room, 'announce', { message: `🏆 ${player.name} won the TROPHY and started a new adventure!` });
        // Everyone needs the regenerated world.
        broadcast(room, 'worldReset', { adventure: room.adventure });
      } else {
        broadcast(room, 'announce', { message: `⭐ ${player.name} reached ${room_stageName(result.newStage - 1)} goal and advanced!` });
      }
      // Send the player their fresh stage + orbs.
      send(ws, 'stageChanged', {
        stage: player.stageIndex,
        orbs: room.getOrbs(player.stageIndex),
        trophy: !!result.trophy,
        adventure: room.adventure
      });
    }
  }
}

function room_stageName(i) {
  // late import avoidance: reference via SHOP? no — use STAGES through config
  return STAGE_NAMES[i] || `Stage ${i + 1}`;
}

function onBuy(ws, msg) {
  const room = registry.getRoom(ws.roomCode);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;
  const item = SHOP_BY_ID.get(msg.itemId);
  const result = room.buyItem(player, item);
  if (result.ok) store.syncFromPlayer(player);
  send(ws, 'buyResult', { ...result, itemId: msg.itemId, cosmetics: player.cosmetics, perks: player.perks, owned: player.owned });
  if (result.ok) {
    // Let others see cosmetic changes.
    broadcast(room, 'playerUpdated', { id: player.id, cosmetics: player.cosmetics }, player.id);
  }
}

function onChat(ws, msg) {
  const room = registry.getRoom(ws.roomCode);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (!player) return;
  const text = String(msg.text || '').slice(0, 120);
  if (!text) return;
  broadcast(room, 'chat', { from: player.name, text });
}

function broadcastRoster(room) {
  const board = room.leaderboard();
  broadcast(room, 'roster', { players: room.snapshot().players, leaderboard: board });
}

// Heartbeat to drop dead connections.
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(interval));

// STAGE_NAMES cache for announcements
const STAGE_NAMES = STAGES.map(s => s.name);

// Persist on shutdown so no progress is lost.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await store.flush(); } catch { store.flushSync(); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await store.init();

server.listen(PORT, () => {
  console.log(`\n🦸  Math Heroes server running!`);
  console.log(`    Game:       http://localhost:${PORT}`);
  console.log(`    Dashboard:  http://localhost:${PORT}/dashboard  (passcode: ${TEACHER_PASSCODE})`);
  console.log(`    Press Ctrl+C to stop.\n`);
});

export { server, registry };
