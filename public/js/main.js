// Math Heroes — client entry point. Wires together networking, the 3D world,
// the local & remote players, UI, and audio into a single game loop.

import * as THREE from 'three';
import { Net } from './net.js';
import { World } from './world.js';
import { preloadHeroModel, createHero, LocalPlayer, RemotePlayer } from './player.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { STAGES, WORLD, FINAL_STAGE_INDEX } from '/shared/config.js';

const net = new Net();
const ui = new UI();
const audio = new Audio();

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
document.getElementById('game-root').appendChild(renderer.domElement);

const world = new World(renderer);

// Game state
const state = {
  myId: null,
  roomCode: null,
  stage: 0,
  adventure: 0,
  coins: 0,
  points: 0,
  orbs: [],
  remotes: new Map(),   // playerId -> RemotePlayer
  local: null,
  lastMoveSent: 0,
  cosmetics: {},
  perks: []
};

ui.init();
preloadHeroModel(); // start fetching the character model while the menu shows

// Loading veil shown while a realm's photoreal HDRI + PBR textures stream in.
const loadingVeil = document.getElementById('loading-veil');
const loadingText = document.getElementById('loading-text');
function showLoading(text) {
  if (loadingText && text) loadingText.textContent = text;
  loadingVeil && loadingVeil.classList.remove('hidden');
}
function hideLoading() { loadingVeil && loadingVeil.classList.add('hidden'); }

// One shared connection for auth + gameplay, opened lazily.
let connecting = null;
function ensureConnected() {
  if (net.connected) return Promise.resolve();
  if (!connecting) connecting = net.connect().finally(() => { connecting = null; });
  return connecting;
}

// ---------- UI callbacks ----------
ui.on('auth', ({ mode, name, pin }) => {
  ensureConnected().then(() => net.send('auth', { mode, name, pin }))
    .catch(() => ui.showStartError('Could not connect to the game server.'));
}).on('logout', () => {
  state.account = null;
  ui.showLoggedOut();
}).on('create', ({ name, hero }) => {
  startAudio();
  ensureConnected().then(() => net.send('create', { name, hero }))
    .catch(() => ui.showStartError('Could not connect to the game server.'));
}).on('join', ({ name, hero, code }) => {
  startAudio();
  ensureConnected().then(() => net.send('join', { name, hero, code }))
    .catch(() => ui.showStartError('Could not connect to the game server.'));
}).on('answer', ({ orbId, answer, button }) => {
  state.pendingButton = button;
  net.send('answer', { orbId, answer });
}).on('buy', ({ itemId }) => {
  net.send('buy', { itemId });
}).on('chat', ({ text }) => {
  net.send('chat', { text });
}).on('puzzleClosed', () => {
  state.activeOrb = null;
}).on('touchmove', ({ x, y }) => {
  if (state.local) state.local.touchDir = { x, y };
}).on('touchjump', () => {
  if (state.local) state.local.touchJump = true;
});

function startAudio() {
  audio.init(); audio.resume(); audio.startMusic();
}

// ---------- Network handlers ----------
net.on('joined', async (m) => {
  state.myId = m.playerId;
  state.roomCode = m.roomCode;
  state.stage = m.stage;
  state.adventure = m.adventure;
  state.coins = m.you.coins;
  state.points = m.you.points;
  state.cosmetics = m.you.cosmetics || {};
  state.perks = m.you.perks || [];
  state.owned = m.you.owned || [];
  state.orbs = m.orbs;

  ui.hideStart();
  ui.setRoom(m.roomCode);
  ui.setStage(state.stage, state.points);
  ui.setCoins(state.coins);
  ui.setOwnership(state.cosmetics, state.perks, state.coins, state.owned);

  state.heroId = m.you.hero;

  // Build world for the stage (streams the realm's HDRI sky + PBR ground)
  showLoading(`Entering ${STAGES[state.stage].name}…`);
  await world.buildStage(state.stage, state.roomCode, state.adventure);
  world.setOrbs(state.orbs);
  if (state.stage === FINAL_STAGE_INDEX) world.showTrophy();

  // Build the animated local hero (async — model loads from CDN, cached)
  const hero = await createHero(m.you.hero, state.cosmetics, m.you.name);
  world.scene.add(hero.group);
  state.local = new LocalPlayer(hero);
  state.local.bindInput();

  // Existing players
  m.players.forEach(p => { if (p.id !== state.myId) addRemote(p); });
  hideLoading();
});

net.on('authed', (m) => {
  state.account = m.profile;
  audio.init(); // a click happened, safe to prime audio
  ui.showLoggedIn(m.profile);
});
net.on('authError', (m) => ui.showStartError(m.message));

net.on('error', (m) => ui.showStartError(m.message));

net.on('playerJoined', (m) => { if (m.player.id !== state.myId) addRemote(m.player); });
net.on('playerLeft', (m) => removeRemote(m.id));

net.on('roster', (m) => {
  ui.setLeaderboard(m.leaderboard, state.myId);
  // Update remote players' stage visibility & cosmetics
  m.players.forEach(p => {
    if (p.id === state.myId) return;
    const r = state.remotes.get(p.id);
    if (r && r !== 'loading') {
      r.mesh.visible = (p.stageIndex === state.stage);
    }
  });
});

net.on('playerMoved', (m) => {
  const r = state.remotes.get(m.id);
  if (r && r !== 'loading') {
    r.setTarget(m.pos);
    r.mesh.visible = (m.stage === state.stage);
  }
});

net.on('playerUpdated', (m) => {
  const r = state.remotes.get(m.id);
  if (r && r !== 'loading' && m.cosmetics) r.hero.setCosmetics(m.cosmetics, r.hero.heroId);
});

net.on('puzzle', (m) => {
  ui.openPuzzle(m.orbId, m);
});
net.on('puzzleUnavailable', () => { state.activeOrb = null; });

net.on('answerResult', (m) => {
  if (!m.ok) { state.activeOrb = null; return; }
  const btn = state.pendingButton;
  ui.showAnswerResult(btn, m.correct, m.answer);
  if (m.correct) {
    audio.correct();
    audio.coin();
    state.points = m.newPoints;
    state.coins = m.newCoins;
    ui.setPoints(state.points, STAGES[state.stage].targetPoints);
    ui.setCoins(state.coins);
    ui.setOwnership(state.cosmetics, state.perks, state.coins, state.owned);
    ui.streak(m.streak);
    // Remove the collected orb locally with a pop
    const mesh = world.orbMeshes.get(m.orbId);
    if (mesh) world.popAt(mesh.position);
    world.removeOrb(m.orbId);
    const orb = state.orbs.find(o => o.id === m.orbId);
    if (orb) orb.collected = true;
  } else {
    audio.wrong();
  }
  state.activeOrb = null;
});

net.on('orbCollected', (m) => {
  if (m.stage !== state.stage) return;
  const mesh = world.orbMeshes.get(m.orbId);
  if (mesh) world.popAt(mesh.position);
  world.removeOrb(m.orbId);
  const orb = state.orbs.find(o => o.id === m.orbId);
  if (orb) orb.collected = true;
});

net.on('stageChanged', async (m) => {
  state.stage = m.stage;
  state.points = 0;
  state.adventure = m.adventure;
  state.orbs = m.orbs;
  // Reset local position to spawn
  if (state.local) { state.local.mesh.position.set(0, 0, 0); state.local.vel.set(0, 0, 0); }
  showLoading(`Entering ${STAGES[state.stage].name}…`);
  await world.buildStage(state.stage, state.roomCode, state.adventure);
  world.setOrbs(state.orbs);
  if (state.stage === FINAL_STAGE_INDEX) world.showTrophy();
  ui.setStage(state.stage, 0);
  hideLoading();

  if (m.trophy) {
    audio.win();
    ui.showWin(() => { /* already reset to stage 0 */ });
  } else {
    audio.stage();
  }
});

net.on('worldReset', (m) => {
  state.adventure = m.adventure;
  // Other players will get their own stageChanged; for us, if we're not the
  // winner, just rebuild current stage with the new adventure seed.
});

net.on('buyResult', (m) => {
  if (m.ok) {
    audio.buy();
    state.cosmetics = m.cosmetics || state.cosmetics;
    state.perks = m.perks || state.perks;
    state.owned = m.owned || state.owned;
    state.coins = m.coins;
    ui.setCoins(state.coins);
    ui.setOwnership(state.cosmetics, state.perks, state.coins, state.owned);
    if (state.local) state.local.hero.setCosmetics(state.cosmetics, state.heroId);
  } else if (m.reason === 'too-poor') {
    ui.announce('Not enough coins! Solve more puzzles 🪙');
  }
});

net.on('announce', (m) => ui.announce(m.message));
net.on('chat', (m) => ui.addChat(m.from, m.text));

// ---------- Remote player helpers ----------
async function addRemote(p) {
  if (state.remotes.has(p.id)) return;
  state.remotes.set(p.id, 'loading'); // reserve slot to avoid double-create
  const hero = await createHero(p.hero, p.cosmetics || {}, p.name);
  // Player may have left while the model loaded.
  if (state.remotes.get(p.id) !== 'loading') { hero.dispose(); return; }
  hero.group.position.set(p.pos.x, p.pos.y, p.pos.z);
  hero.group.visible = (p.stageIndex === state.stage);
  world.scene.add(hero.group);
  const r = new RemotePlayer(hero);
  r.setTarget(p.pos);
  state.remotes.set(p.id, r);
}
function removeRemote(id) {
  const r = state.remotes.get(id);
  if (r && r !== 'loading') {
    world.scene.remove(r.mesh);
    r.hero.dispose();
  }
  state.remotes.delete(id);
}

// ---------- Orb proximity detection ----------
function checkOrbProximity() {
  if (!state.local || ui.puzzleOpen || state.activeOrb) return;
  const pos = state.local.mesh.position;
  for (const orb of state.orbs) {
    if (orb.collected) continue;
    const d = Math.hypot(pos.x - orb.x, pos.z - orb.z);
    if (d < WORLD.orbReach) {
      state.activeOrb = orb.id;
      audio.collect();
      net.send('requestPuzzle', { orbId: orb.id });
      break;
    }
  }
}

// ---------- Camera follow ----------
const camOffset = new THREE.Vector3(0, 9, 14);
function updateCamera(dt) {
  if (!state.local) return;
  const target = state.local.mesh.position;
  const desired = new THREE.Vector3(target.x, target.y + camOffset.y, target.z + camOffset.z);
  // Don't let the camera sink into hills behind the hero.
  const groundAtCam = world.terrainHeight(desired.x, desired.z) + 2.5;
  if (desired.y < groundAtCam) desired.y = groundAtCam;
  world.camera.position.lerp(desired, Math.min(1, dt * 4));
  world.camera.lookAt(target.x, target.y + 2, target.z);
}

// ---------- Main loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state.local) {
    const moving = state.local.update(dt, world.camera, () => audio.jump(),
      (x, z) => world.terrainHeight(x, z));
    updateCamera(dt);
    checkOrbProximity();

    // Throttled position sync (~15/sec)
    if (now - state.lastMoveSent > 66) {
      state.lastMoveSent = now;
      const p = state.local.mesh.position;
      net.send('move', { pos: { x: p.x, y: p.y, z: p.z, ry: state.local.mesh.rotation.y } });
    }
  }

  state.remotes.forEach(r => { if (r !== 'loading') r.update(dt); });
  world.update(dt);
  world.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Resize ----------
window.addEventListener('resize', () => world.resize());

// Expose for debugging / tests
window.__game = { state, net, world, ui };
