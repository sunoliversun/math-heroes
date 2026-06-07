// Persistent profile store for Math Heroes.
//
// Each child has a profile keyed by a lowercased username, protected by a 4-digit
// PIN (hashed with scrypt). Profiles remember coins, cosmetics, owned items,
// perks, trophies, lifetime score, highest stage, play time, and per-skill math
// stats (for the parent/teacher dashboard).
//
// Storage is pluggable:
//   • DATABASE_URL set  -> Postgres (e.g. Neon free tier) — survives redeploys.
//   • otherwise         -> local JSON file (atomic write-temp-then-rename).
// Profiles are cached in memory and written back debounced, per dirty key.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

const SKILLS = ['count', 'add', 'sub', 'mul', 'div', 'pattern', 'fraction'];

let profiles = {};            // usernameLower -> profile
let sessions = new Map();     // sessionId -> usernameLower
let dirtyKeys = new Set();    // profile keys awaiting persistence
let writeTimer = null;
let backend = null;           // chosen storage backend (file or postgres)

// ---- password hashing -------------------------------------------------------
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  // constant-time compare
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- storage backends -------------------------------------------------------
// A backend exposes: init(), loadAll() -> profiles object, upsert(key, profile),
// and (file only) saveAllSync() for synchronous shutdown saves.

function fileBackend() {
  return {
    kind: 'file',
    async init() { await fsp.mkdir(DATA_DIR, { recursive: true }); },
    async loadAll() {
      try { return JSON.parse(await fsp.readFile(PROFILES_FILE, 'utf8')); }
      catch { return {}; }
    },
    // The file holds every profile, so any upsert rewrites the whole file
    // atomically (small data; perfectly fine for one game server).
    async upsert() {
      const tmp = PROFILES_FILE + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(profiles, null, 2));
      await fsp.rename(tmp, PROFILES_FILE);
    },
    saveAllSync() {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
    }
  };
}

// Postgres backend (e.g. Neon free tier). Activated when DATABASE_URL is set.
// `pg` is imported lazily so local/file installs don't need it.
function postgresBackend(connectionString) {
  let pool = null;
  return {
    kind: 'postgres',
    async init() {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }, // Neon/most hosts require SSL
        max: 4
      });
      await pool.query(`CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )`);
    },
    async loadAll() {
      const { rows } = await pool.query('SELECT username, data FROM profiles');
      const out = {};
      for (const r of rows) out[r.username] = r.data;
      return out;
    },
    async upsert(key) {
      await pool.query(
        `INSERT INTO profiles (username, data) VALUES ($1, $2)
         ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data`,
        [key, profiles[key]]
      );
    },
    saveAllSync() { /* async-only; rely on flush() during shutdown */ }
  };
}

// ---- persistence ------------------------------------------------------------
export async function init() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      backend = postgresBackend(url);
      await backend.init();
      console.log('💾  Profiles: Postgres (persistent cloud database)');
    } catch (e) {
      console.warn('⚠️  Postgres unavailable (' + e.message + '); falling back to file storage.');
      backend = fileBackend();
      await backend.init();
    }
  } else {
    backend = fileBackend();
    await backend.init();
    console.log('💾  Profiles: local file storage (' + PROFILES_FILE + ')');
  }
  profiles = await backend.loadAll();
}

function markDirty(key) {
  dirtyKeys.add(key);
  if (writeTimer) return;
  writeTimer = setTimeout(flush, 800);
}

export async function flush() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  if (!dirtyKeys.size || !backend) return;
  const keys = [...dirtyKeys];
  dirtyKeys.clear();
  for (const key of keys) {
    if (profiles[key]) {
      try { await backend.upsert(key); }
      catch (e) { console.warn('persist failed for', key, e.message); dirtyKeys.add(key); }
    }
  }
}

// Best-effort synchronous save for process shutdown (file backend only).
export function flushSync() {
  if (!dirtyKeys.size || !backend || !backend.saveAllSync) return;
  try { backend.saveAllSync(); dirtyKeys.clear(); } catch { /* ignore */ }
}

// ---- profile shape ----------------------------------------------------------
function blankProfile(username) {
  const perSkill = {};
  SKILLS.forEach(s => { perSkill[s] = { attempts: 0, correct: 0 }; });
  return {
    username,
    pinHash: '',
    created: nowIso(),
    lastSeen: nowIso(),
    coins: 0,
    totalScore: 0,
    trophies: 0,
    highestStage: 0,
    playMs: 0,
    cosmetics: { color: null, cape: null, hat: null, trail: null },
    owned: [],
    perks: [],
    stats: { puzzlesAttempted: 0, puzzlesSolved: 0, perSkill }
  };
}

function nowIso() {
  // Date.now via the wall clock is fine on the server (not inside a workflow).
  return new Date().toISOString();
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 14);
}

// ---- public API -------------------------------------------------------------
export function register(name, pin) {
  const username = cleanName(name);
  if (username.length < 2) return { ok: false, reason: 'Name must be at least 2 letters.' };
  if (!/^\d{4}$/.test(String(pin || ''))) return { ok: false, reason: 'PIN must be 4 digits.' };
  const key = username.toLowerCase();
  if (profiles[key]) return { ok: false, reason: 'That name is taken. Try logging in or pick another.' };
  const profile = blankProfile(username);
  profile.pinHash = hashPin(pin);
  profiles[key] = profile;
  markDirty(key);
  const sessionId = startSession(key);
  return { ok: true, sessionId, profile: publicProfile(profile) };
}

export function login(name, pin) {
  const key = cleanName(name).toLowerCase();
  const profile = profiles[key];
  if (!profile) return { ok: false, reason: 'No hero with that name. Tap "New Hero" to create one.' };
  if (!verifyPin(pin, profile.pinHash)) return { ok: false, reason: 'Wrong PIN. Try again!' };
  profile.lastSeen = nowIso();
  markDirty(key);
  const sessionId = startSession(key);
  return { ok: true, sessionId, profile: publicProfile(profile) };
}

function startSession(key) {
  const sessionId = crypto.randomBytes(18).toString('hex');
  sessions.set(sessionId, key);
  return sessionId;
}

export function profileForSession(sessionId) {
  const key = sessions.get(sessionId);
  if (!key) return null;
  return profiles[key] || null;
}

export function endSession(sessionId) {
  sessions.delete(sessionId);
}

// Hydrate a fresh in-game player object with a profile's saved progress.
export function hydratePlayer(player, profile) {
  player.username = profile.username;
  player.coins = profile.coins;
  player.totalScore = profile.totalScore;
  player.trophies = profile.trophies;
  player.cosmetics = { ...profile.cosmetics };
  player.owned = [...profile.owned];
  player.perks = [...profile.perks];
}

// Copy a player's live progress back into their profile (called on key events).
export function syncFromPlayer(player) {
  if (!player || !player.username) return;
  const key = player.username.toLowerCase();
  const profile = profiles[key];
  if (!profile) return;
  profile.coins = player.coins;
  profile.totalScore = player.totalScore;
  profile.trophies = player.trophies;
  profile.cosmetics = { ...player.cosmetics };
  profile.owned = [...player.owned];
  profile.perks = [...player.perks];
  profile.highestStage = Math.max(profile.highestStage, player.stageIndex);
  profile.lastSeen = nowIso();
  markDirty(key);
}

// Record one puzzle attempt for the dashboard stats.
export function recordAttempt(player, skill, correct) {
  if (!player || !player.username) return;
  const key = player.username.toLowerCase();
  const profile = profiles[key];
  if (!profile) return;
  const st = profile.stats;
  st.puzzlesAttempted++;
  if (correct) st.puzzlesSolved++;
  if (st.perSkill[skill]) {
    st.perSkill[skill].attempts++;
    if (correct) st.perSkill[skill].correct++;
  }
  markDirty(key);
}

export function addPlaytime(player, ms) {
  if (!player || !player.username || !ms) return;
  const key = player.username.toLowerCase();
  const profile = profiles[key];
  if (!profile) return;
  profile.playMs += ms;
  profile.lastSeen = nowIso();
  markDirty(key);
}

// Profile data safe to send to a client (never the PIN hash).
function publicProfile(p) {
  return {
    username: p.username, coins: p.coins, totalScore: p.totalScore,
    trophies: p.trophies, highestStage: p.highestStage,
    cosmetics: p.cosmetics, owned: p.owned, perks: p.perks
  };
}

// ---- dashboard aggregate ----------------------------------------------------
export function dashboardData() {
  const kids = Object.values(profiles).map(p => {
    const perSkill = {};
    let totalAtt = 0, totalCor = 0;
    for (const s of SKILLS) {
      const e = p.stats?.perSkill?.[s] || { attempts: 0, correct: 0 };
      perSkill[s] = {
        attempts: e.attempts,
        correct: e.correct,
        accuracy: e.attempts ? Math.round((e.correct / e.attempts) * 100) : null
      };
      totalAtt += e.attempts; totalCor += e.correct;
    }
    return {
      username: p.username,
      coins: p.coins,
      totalScore: p.totalScore,
      trophies: p.trophies,
      highestStage: p.highestStage,
      playMinutes: Math.round((p.playMs || 0) / 60000),
      lastSeen: p.lastSeen,
      created: p.created,
      puzzlesSolved: p.stats?.puzzlesSolved || 0,
      puzzlesAttempted: p.stats?.puzzlesAttempted || 0,
      overallAccuracy: totalAtt ? Math.round((totalCor / totalAtt) * 100) : null,
      perSkill
    };
  });
  kids.sort((a, b) => b.totalScore - a.totalScore);

  const totals = {
    children: kids.length,
    puzzlesSolved: kids.reduce((s, k) => s + k.puzzlesSolved, 0),
    trophies: kids.reduce((s, k) => s + k.trophies, 0),
    playMinutes: kids.reduce((s, k) => s + k.playMinutes, 0)
  };
  return { generatedAt: nowIso(), totals, kids, skills: SKILLS };
}

export { SKILLS };
