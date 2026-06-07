import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the store at a throwaway data dir BEFORE importing it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-store-'));
process.env.DATA_DIR = TMP;
const store = await import('../server/store.js');

before(async () => { await store.init(); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

test('register creates a profile and returns a session', () => {
  const r = store.register('Sammy', '1234');
  assert.ok(r.ok);
  assert.ok(r.sessionId);
  assert.equal(r.profile.username, 'Sammy');
  assert.equal(r.profile.coins, 0);
});

test('register rejects bad names and PINs', () => {
  assert.equal(store.register('A', '1234').ok, false, 'too-short name');
  assert.equal(store.register('Bob', '12').ok, false, 'short pin');
  assert.equal(store.register('Bob', 'abcd').ok, false, 'non-numeric pin');
});

test('duplicate registration is rejected', () => {
  store.register('Dup', '0000');
  const r = store.register('dup', '1111'); // case-insensitive
  assert.equal(r.ok, false);
});

test('login requires the correct PIN', () => {
  store.register('Kid', '4321');
  assert.equal(store.login('Kid', '0000').ok, false, 'wrong pin rejected');
  const good = store.login('Kid', '4321');
  assert.ok(good.ok);
  assert.ok(good.sessionId);
});

test('login fails for unknown user', () => {
  assert.equal(store.login('Ghost', '1234').ok, false);
});

test('session resolves to a profile', () => {
  const r = store.register('Sessioner', '2468');
  const profile = store.profileForSession(r.sessionId);
  assert.ok(profile);
  assert.equal(profile.username, 'Sessioner');
  assert.equal(store.profileForSession('bogus'), null);
});

test('hydratePlayer and syncFromPlayer round-trip progress', () => {
  const r = store.register('Saver', '1357');
  const profile = store.profileForSession(r.sessionId);
  const player = {
    username: 'Saver', coins: 0, totalScore: 0, trophies: 0, stageIndex: 0,
    cosmetics: { color: null, cape: null, hat: null, trail: null }, owned: [], perks: []
  };
  store.hydratePlayer(player, profile);
  // simulate play
  player.coins = 120; player.totalScore = 540; player.trophies = 2;
  player.stageIndex = 3; player.cosmetics.cape = '#e23b3b'; player.owned.push('cape_red');
  store.syncFromPlayer(player);

  // re-login fresh and confirm it persisted in memory
  const p2 = store.profileForSession(store.login('Saver', '1357').sessionId);
  assert.equal(p2.coins, 120);
  assert.equal(p2.trophies, 2);
  assert.equal(p2.highestStage, 3);
  assert.deepEqual(p2.owned, ['cape_red']);
});

test('recordAttempt updates per-skill stats and dashboard', () => {
  const r = store.register('Mathlete', '9999');
  const player = { username: 'Mathlete' };
  store.recordAttempt(player, 'add', true);
  store.recordAttempt(player, 'add', false);
  store.recordAttempt(player, 'mul', true);
  const data = store.dashboardData();
  const kid = data.kids.find(k => k.username === 'Mathlete');
  assert.equal(kid.puzzlesAttempted, 3);
  assert.equal(kid.puzzlesSolved, 2);
  assert.equal(kid.perSkill.add.attempts, 2);
  assert.equal(kid.perSkill.add.correct, 1);
  assert.equal(kid.perSkill.add.accuracy, 50);
  assert.equal(kid.perSkill.mul.accuracy, 100);
});

test('dashboard aggregates totals across children', () => {
  const data = store.dashboardData();
  assert.ok(data.totals.children >= 1);
  assert.ok(typeof data.totals.puzzlesSolved === 'number');
  assert.ok(Array.isArray(data.skills));
});

test('flush writes the profiles file to disk', async () => {
  store.register('Persist', '1212');
  await store.flush();
  const file = path.join(TMP, 'profiles.json');
  assert.ok(fs.existsSync(file));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(saved['persist'], 'profile keyed by lowercased name');
  assert.ok(!('pin' in saved['persist']), 'raw PIN never stored');
  assert.ok(saved['persist'].pinHash.includes(':'), 'PIN stored as salted hash');
});
