import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Room, RoomRegistry, generateRoomCode, generateOrbs, publicPlayer
} from '../server/gameState.js';
import { STAGES, FINAL_STAGE_INDEX, TROPHY_COIN_BONUS, POINTS_PER_PUZZLE } from '../shared/config.js';
import { SHOP_ITEMS } from '../shared/config.js';

const itemById = id => SHOP_ITEMS.find(i => i.id === id);

// Helper: keep answering an orb's puzzle correctly until the player advances or
// runs out of orbs in the current stage. Returns number of correct answers.
function clearStage(room, player) {
  let solved = 0;
  const startStage = player.stageIndex;
  while (player.stageIndex === startStage) {
    const orbs = room.getOrbs(player.stageIndex).filter(o => !o.collected);
    if (orbs.length === 0) break;
    const orb = orbs[0];
    const puzzle = room.puzzleFor(player, orb.id);
    const res = room.submitAnswer(player, orb.id, puzzle.answer);
    assert.ok(res.ok && res.correct, 'correct answer accepted');
    solved++;
    if (res.stageComplete) break;
  }
  return solved;
}

test('every stage is completable even with zero streak (balance guard)', () => {
  // base points = orbCount * POINTS_PER_PUZZLE must comfortably exceed target
  // so a kid who never builds a streak can still finish each stage.
  STAGES.forEach((s) => {
    const base = s.orbCount * POINTS_PER_PUZZLE;
    assert.ok(base >= s.targetPoints * 1.1,
      `${s.id}: base ${base} should be >=110% of target ${s.targetPoints}`);
  });
});

test('generateRoomCode is 4 chars from safe alphabet', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, 4);
    assert.match(code, /^[A-HJ-NP-Z2-9]+$/, 'no confusing chars O/0/I/1');
  }
});

test('generateOrbs is deterministic and within bounds', () => {
  const a = generateOrbs('TEST', 0, 0);
  const b = generateOrbs('TEST', 0, 0);
  assert.deepEqual(a, b);
  assert.equal(a.length, STAGES[0].orbCount);
  a.forEach(o => {
    assert.ok(Math.abs(o.x) <= 60 && Math.abs(o.z) <= 60);
    assert.equal(o.collected, false);
  });
});

test('different adventures give different orb layouts', () => {
  const a = generateOrbs('TEST', 0, 0);
  const b = generateOrbs('TEST', 0, 1);
  assert.notDeepEqual(a, b);
});

test('addPlayer initializes a fresh hero', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'aqua');
  assert.equal(p.name, 'Sam');
  assert.equal(p.hero, 'aqua');
  assert.equal(p.stageIndex, 0);
  assert.equal(p.coins, 0);
  assert.equal(p.points, 0);
});

test('player name is trimmed to 14 chars and defaults', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'ThisIsAVeryLongHeroName', 'comet');
  assert.equal(p.name.length, 14);
  const p2 = room.addPlayer('p2', '', 'comet');
  assert.equal(p2.name, 'Hero');
});

test('correct answer awards points and coins; orb becomes collected', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  const orb = room.getOrbs(0)[0];
  const puzzle = room.puzzleFor(p, orb.id);
  const res = room.submitAnswer(p, orb.id, puzzle.answer);
  assert.ok(res.correct);
  assert.ok(res.points > 0);
  assert.ok(res.coins > 0);
  assert.equal(p.points, res.points);
  assert.equal(room.getOrbs(0)[0].collected, true);
});

test('wrong answer resets streak and does not collect orb', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  const orb = room.getOrbs(0)[0];
  const puzzle = room.puzzleFor(p, orb.id);
  const wrong = puzzle.answer + 1;
  const res = room.submitAnswer(p, orb.id, wrong);
  assert.ok(res.ok);
  assert.equal(res.correct, false);
  assert.equal(p.points, 0);
  assert.equal(p.streak, 0);
  assert.equal(room.getOrbs(0)[0].collected, false);
});

test('cannot collect an already-collected orb', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  const orb = room.getOrbs(0)[0];
  const puzzle = room.puzzleFor(p, orb.id);
  room.submitAnswer(p, orb.id, puzzle.answer);
  const res2 = room.submitAnswer(p, orb.id, puzzle.answer);
  assert.equal(res2.ok, false);
  assert.equal(res2.reason, 'already-collected');
});

test('streak increases points on consecutive correct answers', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  const orbs = room.getOrbs(0);
  const r1 = room.submitAnswer(p, orbs[0].id, room.puzzleFor(p, orbs[0].id).answer);
  const r2 = room.submitAnswer(p, orbs[1].id, room.puzzleFor(p, orbs[1].id).answer);
  assert.ok(r2.points > r1.points, 'second correct in a row worth more');
  assert.equal(p.streak, 2);
});

test('reaching target advances to the next stage', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  clearStage(room, p);
  assert.equal(p.stageIndex, 1, 'advanced to stage 2');
  assert.equal(p.points, 0, 'points reset for new stage');
});

test('full playthrough to trophy resets adventure and awards bonus', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  let guard = 0;
  let wonTrophy = false;
  const startAdventure = room.adventure;
  while (guard++ < 200) {
    const orbs = room.getOrbs(p.stageIndex).filter(o => !o.collected);
    if (orbs.length === 0) { assert.fail('ran out of orbs before winning'); }
    const orb = orbs[0];
    const puzzle = room.puzzleFor(p, orb.id);
    const res = room.submitAnswer(p, orb.id, puzzle.answer);
    if (res.trophy) { wonTrophy = true; break; }
  }
  assert.ok(wonTrophy, 'eventually wins the trophy');
  assert.equal(p.trophies, 1);
  assert.equal(p.stageIndex, 0, 'adventure restarts at stage 0');
  assert.ok(p.coins >= TROPHY_COIN_BONUS, 'trophy coin bonus awarded');
  assert.equal(room.adventure, startAdventure + 1, 'adventure number bumped');
});

test('buying a cosmetic deducts coins and equips it', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  p.coins = 100;
  const item = itemById('color_purple');
  const res = room.buyItem(p, item);
  assert.ok(res.ok && res.bought);
  assert.equal(p.coins, 100 - item.cost);
  assert.equal(p.cosmetics.color, item.value);
});

test('cannot buy what you cannot afford', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  p.coins = 5;
  const res = room.buyItem(p, itemById('hat_crown'));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'too-poor');
  assert.equal(p.coins, 5);
});

test('re-equipping an owned cosmetic is free', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  p.coins = 100;
  const item = itemById('cape_red');
  room.buyItem(p, item);
  const coinsAfter = p.coins;
  // switch to another then back
  p.cosmetics.cape = null;
  const res = room.buyItem(p, item);
  assert.ok(res.ok && res.equipped);
  assert.equal(p.coins, coinsAfter, 'no extra charge');
});

test('coin booster perk grants extra coins per puzzle', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  p.coins = 1000;
  room.buyItem(p, itemById('perk_boost'));
  const before = p.coins;
  const orb = room.getOrbs(0)[0];
  const res = room.submitAnswer(p, orb.id, room.puzzleFor(p, orb.id).answer);
  assert.ok(res.coins >= 7, 'boosted coins (5 base + 2)');
});

test('RoomRegistry creates unique rooms and looks them up case-insensitively', () => {
  const reg = new RoomRegistry();
  const r1 = reg.createRoom();
  const r2 = reg.createRoom();
  assert.notEqual(r1.code, r2.code);
  assert.equal(reg.getRoom(r1.code.toLowerCase()), r1);
  reg.removeRoom(r1.code);
  assert.equal(reg.getRoom(r1.code), undefined);
});

test('two players share the same orb layout per stage', () => {
  const room = new Room('ABCD');
  const a = room.addPlayer('p1', 'A', 'comet');
  const b = room.addPlayer('p2', 'B', 'aqua');
  const orbsA = room.getOrbs(0);
  const orbsB = room.getOrbs(0);
  assert.strictEqual(orbsA, orbsB, 'same orb array instance for the room/stage');
});

test('snapshot and publicPlayer never leak puzzle answers', () => {
  const room = new Room('ABCD');
  const p = room.addPlayer('p1', 'Sam', 'comet');
  const snap = room.snapshot();
  assert.ok(Array.isArray(snap.players));
  const pub = publicPlayer(p);
  assert.ok(!('correct' in pub) && !('attempts' in pub));
});

test('leaderboard sorts by trophies then total score', () => {
  const room = new Room('ABCD');
  const a = room.addPlayer('p1', 'A', 'comet');
  const b = room.addPlayer('p2', 'B', 'aqua');
  a.totalScore = 50; b.totalScore = 80;
  let board = room.leaderboard();
  assert.equal(board[0].id, 'p2');
  a.trophies = 1;
  board = room.leaderboard();
  assert.equal(board[0].id, 'p1', 'trophies outrank score');
});
