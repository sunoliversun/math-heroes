// Live end-to-end test against a running server: two players, room codes,
// movement sync, puzzle solving, shop purchase, and trophy win + reset.
import { WebSocket } from 'ws';

const URL = 'ws://localhost:3000';
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✔', msg); } else { failed++; console.log('  ✖', msg); } };

function client() {
  const ws = new WebSocket(URL);
  const waiters = [];   // { type, resolve }
  const inbox = [];     // unconsumed messages
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    // Satisfy the oldest matching waiter; otherwise queue the message.
    const wi = waiters.findIndex(w => w.type === m.type);
    if (wi !== -1) { const [w] = waiters.splice(wi, 1); w.resolve(m); }
    else inbox.push(m);
  });
  return {
    ws,
    ready: () => new Promise(r => ws.on('open', r)),
    send: (type, p = {}) => ws.send(JSON.stringify({ type, ...p })),
    // Consume (remove) the next message of `type`, waiting if needed.
    next: (type, timeout = 3000) => new Promise((resolve, reject) => {
      const i = inbox.findIndex(m => m.type === type);
      if (i !== -1) { const [m] = inbox.splice(i, 1); return resolve(m); }
      const t = setTimeout(() => reject(new Error('timeout waiting for ' + type)), timeout);
      waiters.push({ type, resolve: (m) => { clearTimeout(t); resolve(m); } });
    }),
    close: () => ws.close()
  };
}

async function run() {
  console.log('Integration test: Math Heroes server\n');

  // --- Player 1 creates a room ---
  const a = client();
  await a.ready();
  a.send('create', { name: 'Alice', hero: 'comet' });
  const joinedA = await a.next('joined');
  ok(joinedA.roomCode && joinedA.roomCode.length === 4, 'P1 created room, got 4-letter code: ' + joinedA.roomCode);
  ok(Array.isArray(joinedA.orbs) && joinedA.orbs.length > 0, 'P1 received orbs for stage 1');
  ok(joinedA.you.coins === 0, 'P1 starts with 0 coins');
  const code = joinedA.roomCode;

  // --- Player 2 joins with the code ---
  const b = client();
  await b.ready();
  b.send('join', { name: 'Bob', hero: 'aqua', code });
  const joinedB = await b.next('joined');
  ok(joinedB.roomCode === code, 'P2 joined the same room via code');
  ok(joinedB.players.length === 2, 'P2 sees 2 players in room');

  // P1 should be notified P2 joined
  const pj = await a.next('playerJoined');
  ok(pj.player.name === 'Bob', 'P1 notified that Bob joined');

  // --- Bad code rejected ---
  const c = client();
  await c.ready();
  c.send('join', { name: 'Eve', hero: 'leaf', code: 'ZZZZ' });
  const err = await c.next('error');
  ok(/not found/i.test(err.message), 'Joining a bad code returns an error');
  c.close();

  // --- Movement sync ---
  a.send('move', { pos: { x: 5, y: 0, z: -3, ry: 1 } });
  const moved = await b.next('playerMoved');
  ok(Math.abs(moved.pos.x - 5) < 0.001, 'P2 receives P1 movement updates');

  // --- Puzzle request + correct answer ---
  // The client never gets the answer, so we must answer via brute force over
  // the 4 choices until the server says correct.
  async function solveOneOrb(cl, orbId) {
    cl.send('requestPuzzle', { orbId });
    const pz = await cl.next('puzzle');
    ok(pz.answer === undefined, 'Puzzle payload never contains the answer');
    ok(pz.choices.length === 4, 'Puzzle has 4 choices');
    for (const choice of pz.choices) {
      cl.send('answer', { orbId, answer: choice });
      const res = await cl.next('answerResult');
      if (res.correct) return res;
    }
    throw new Error('no choice was correct?!');
  }

  const firstOrb = joinedA.orbs[0].id;
  const res1 = await solveOneOrb(a, firstOrb);
  ok(res1.correct && res1.points > 0, 'P1 solved a puzzle and earned points');
  ok(res1.newCoins > 0, 'P1 earned coins');

  // P2 should see the orb get collected
  const collected = await b.next('orbCollected');
  ok(collected.orbId === firstOrb, 'P2 sees the orb P1 collected (worlds stay in sync)');

  // roster/leaderboard broadcast
  const roster = await a.next('roster');
  ok(Array.isArray(roster.leaderboard), 'Leaderboard broadcast to room');

  // --- Shop purchase ---
  // Solve orbs (following stage transitions, since coins carry across stages)
  // until Alice can afford a 30-coin color, then buy it.
  let orbsQ = joinedA.orbs.map(o => o.id).slice(1);
  let lastCoins = res1.newCoins;
  let guardG = 0;
  while (lastCoins < 30 && guardG++ < 60) {
    if (orbsQ.length === 0) break;
    const orbId = orbsQ.shift();
    const r = await solveOneOrbQuiet(a, orbId);
    if (r.skip) continue;
    if (typeof r.newCoins === 'number') lastCoins = r.newCoins;
    if (r.stageComplete && !r.trophy) {
      const sc = await a.next('stageChanged');
      orbsQ = sc.orbs.map(o => o.id);
    }
  }
  ok(lastCoins >= 30, `P1 earned enough coins to shop (${lastCoins})`);
  a.send('buy', { itemId: 'color_purple' });
  const buy = await a.next('buyResult');
  ok(buy.ok && buy.itemId === 'color_purple', 'P1 bought a cosmetic from the shop');
  ok(buy.cosmetics.color, 'Bought color is equipped on the player');

  // --- Chat ---
  a.send('chat', { text: 'hi team!' });
  const chat = await b.next('chat');
  ok(chat.text === 'hi team!' && chat.from === 'Alice', 'Chat is relayed between players');

  // --- Full trophy run by a fresh solo player ---
  const d = client();
  await d.ready();
  d.send('create', { name: 'Champ', hero: 'nova' });
  const jd = await d.next('joined');
  let stageOrbs = jd.orbs.map(o => o.id);
  let wonTrophy = false;
  let guard = 0;
  while (!wonTrophy && guard++ < 300) {
    if (stageOrbs.length === 0) { console.log('  (out of orbs unexpectedly)'); break; }
    const orbId = stageOrbs.shift();
    let res;
    try { res = await solveOneOrbQuiet(d, orbId); } catch { continue; }
    if (res.skip) continue;
    if (res.trophy) { wonTrophy = true; break; }
    if (res.stageComplete) {
      const sc = await d.next('stageChanged');
      stageOrbs = sc.orbs.map(o => o.id);
      if (sc.trophy) { wonTrophy = true; break; }
    }
  }
  ok(wonTrophy, 'A player can play through all 5 stages and win the trophy');

  async function solveOneOrbQuiet(cl, orbId) {
    cl.send('requestPuzzle', { orbId });
    // The orb may be unavailable (collected/stale) — handle both replies.
    const pz = await Promise.race([
      cl.next('puzzle', 4000),
      cl.next('puzzleUnavailable', 4000).then(u => ({ unavailable: true }))
    ]);
    if (pz.unavailable) return { skip: true };
    for (const choice of pz.choices) {
      cl.send('answer', { orbId, answer: choice });
      const res = await cl.next('answerResult');
      if (res.correct) return res;
    }
    throw new Error('none correct');
  }

  // --- Persistence & dashboard ---
  const heroName = 'Kid' + (Date.now() % 100000);
  const e = client();
  await e.ready();
  e.send('auth', { mode: 'register', name: heroName, pin: '1234' });
  const authed = await e.next('authed');
  ok(authed.profile.username === heroName && authed.profile.coins === 0, 'New account registered with a saved profile');

  e.send('create', { name: heroName, hero: 'comet' });
  const je = await e.next('joined');
  ok(je.you.name === heroName, 'Logged-in player plays under their saved name');
  // Earn some coins
  let earnedCoins = 0;
  for (const orb of je.orbs.slice(0, 3)) {
    const r = await solveOneOrbQuiet(e, orb.id);
    if (r.skip) continue;
    if (typeof r.newCoins === 'number') earnedCoins = r.newCoins;
  }
  ok(earnedCoins > 0, 'Logged-in player earned coins');
  e.close();
  await new Promise(r => setTimeout(r, 300)); // let the server persist on disconnect

  // Log back in on a fresh connection — coins should have persisted.
  const e2 = client();
  await e2.ready();
  e2.send('auth', { mode: 'login', name: heroName, pin: '1234' });
  const relog = await e2.next('authed');
  ok(relog.profile.coins === earnedCoins, `Coins persisted across sessions (${relog.profile.coins})`);
  // Wrong PIN is rejected
  const e3 = client();
  await e3.ready();
  e3.send('auth', { mode: 'login', name: heroName, pin: '0000' });
  const authErr = await e3.next('authError');
  ok(/PIN/i.test(authErr.message), 'Wrong PIN is rejected');
  e2.close(); e3.close();

  // Dashboard API: protected and reports our hero.
  const bad = await fetch('http://localhost:3000/api/dashboard?pass=wrong');
  ok(bad.status === 401, 'Dashboard rejects a wrong passcode');
  const good = await fetch('http://localhost:3000/api/dashboard?pass=teach1234');
  const dash = await good.json();
  const me = dash.kids.find(k => k.username === heroName);
  ok(me && me.puzzlesSolved > 0, 'Dashboard reports the hero\'s solved puzzles');
  ok(typeof me.overallAccuracy === 'number', 'Dashboard computes accuracy');

  a.close(); b.close(); d.close();

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
