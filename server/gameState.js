// Authoritative game & room state for Math Heroes.
// This module knows NOTHING about WebSockets — it's pure logic so it can be
// unit-tested. server.js wires it up to the network.

import {
  STAGES, FINAL_STAGE_INDEX, WORLD, POINTS_PER_PUZZLE, STREAK_BONUS,
  COINS_PER_PUZZLE, TROPHY_COIN_BONUS, makeRng, seedFor
} from '../shared/config.js';
import { generatePuzzle, checkAnswer } from '../shared/mathEngine.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing O/0/I/1

export function generateRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  }
  return code;
}

// Generate the orb layout for a (room, stage, adventure). Deterministic so all
// clients render identical worlds. Returns array of { id, x, z, collected }.
export function generateOrbs(roomCode, stageIndex, adventure) {
  const stage = STAGES[stageIndex];
  const seed = seedFor(roomCode, stageIndex, adventure);
  const rng = makeRng(seed);
  const orbs = [];
  const span = WORLD.size - 8;
  for (let i = 0; i < stage.orbCount; i++) {
    orbs.push({
      id: `${stageIndex}_${i}`,
      x: (rng() * 2 - 1) * span,
      z: (rng() * 2 - 1) * span,
      collected: false,
      // who collected it (for display); puzzle generated on demand
      collectedBy: null
    });
  }
  return orbs;
}

export class Room {
  constructor(code, adventure = 0) {
    this.code = code;
    this.adventure = adventure;       // increments each time someone wins -> harder
    this.players = new Map();         // playerId -> player object
    this.orbsByStage = new Map();     // stageIndex -> orb array (shared per room)
    this.createdAt = Date.now();
  }

  getOrbs(stageIndex) {
    if (!this.orbsByStage.has(stageIndex)) {
      this.orbsByStage.set(stageIndex, generateOrbs(this.code, stageIndex, this.adventure));
    }
    return this.orbsByStage.get(stageIndex);
  }

  addPlayer(id, name, hero) {
    const player = {
      id,
      username: null,      // set when the player is logged into a saved profile
      name: (name || 'Hero').slice(0, 14),
      hero: hero || 'comet',
      stageIndex: 0,
      points: 0,           // points within the current stage
      totalScore: 0,       // lifetime score across stages
      coins: 0,
      streak: 0,
      correct: 0,
      attempts: 0,
      pos: { x: 0, y: 0, z: 0, ry: 0 },
      cosmetics: { color: null, cape: null, hat: null, trail: null },
      owned: [],           // ids of all cosmetics/perks the player has bought
      perks: [],
      trophies: 0,
      puzzleCache: new Map() // orbId -> the exact puzzle shown (so it matches on submit)
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  get isEmpty() {
    return this.players.size === 0;
  }

  // Recent accuracy used to drive adaptive difficulty.
  accuracyOf(player) {
    if (player.attempts === 0) return 0.5;
    return player.correct / player.attempts;
  }

  // Get the puzzle for a specific orb & player. Generated once per (orb, visit)
  // and cached so the puzzle a kid SEES is exactly the one validated on submit
  // (difficulty is locked in at the moment the puzzle is first shown). The cache
  // entry is cleared when the orb is solved (see submitAnswer).
  puzzleFor(player, orbId) {
    const stage = player.stageIndex;
    const orbs = this.getOrbs(stage);
    const orb = orbs.find(o => o.id === orbId);
    if (!orb || orb.collected) return null;

    const cacheKey = `${this.adventure}:${stage}:${orbId}`;
    const cached = player.puzzleCache.get(cacheKey);
    if (cached) return cached;

    // Seed per orb + player so two players at the same orb can get fair,
    // independent questions, and answers can't be copied blindly.
    const base = seedFor(this.code + player.id, stage, this.adventure);
    const seed = (base ^ hashStr(orbId)) >>> 0;
    const puzzle = generatePuzzle(seed, stage, this.accuracyOf(player));
    player.puzzleCache.set(cacheKey, puzzle);
    return puzzle;
  }

  // Resolve an answer attempt. Returns a result describing what happened.
  submitAnswer(player, orbId, given) {
    const stage = player.stageIndex;
    const orbs = this.getOrbs(stage);
    const orb = orbs.find(o => o.id === orbId);
    if (!orb) return { ok: false, reason: 'no-orb' };
    if (orb.collected) return { ok: false, reason: 'already-collected' };

    const puzzle = this.puzzleFor(player, orbId);
    if (!puzzle) return { ok: false, reason: 'no-puzzle' };

    player.attempts++;
    const correct = checkAnswer(puzzle, given);

    if (!correct) {
      player.streak = 0;
      return { ok: true, correct: false, answer: puzzle.answer, skill: puzzle.skill };
    }

    // Correct!
    player.correct++;
    player.streak++;
    orb.collected = true;
    orb.collectedBy = player.id;
    player.puzzleCache.delete(`${this.adventure}:${stage}:${orbId}`);

    const points = POINTS_PER_PUZZLE + (player.streak - 1) * STREAK_BONUS;
    let coins = COINS_PER_PUZZLE;
    if (player.perks.includes('boost')) coins += 2;

    player.points += points;
    player.totalScore += points;
    player.coins += coins;

    const result = {
      ok: true, correct: true, points, coins, orbId, skill: puzzle.skill,
      newPoints: player.points, newTotal: player.totalScore, newCoins: player.coins,
      streak: player.streak
    };

    // Did they reach the stage target?
    if (player.points >= STAGES[stage].targetPoints) {
      result.stageComplete = true;
      if (stage >= FINAL_STAGE_INDEX) {
        // WIN! Award trophy and reset the adventure for this player.
        result.trophy = true;
        player.trophies++;
        player.coins += TROPHY_COIN_BONUS;
        result.newCoins = player.coins;
        this.resetPlayerAdventure(player);
        result.newStage = player.stageIndex;
        result.adventure = this.adventure;
      } else {
        player.stageIndex = stage + 1;
        player.points = 0;
        result.newStage = player.stageIndex;
        // Ensure next stage orbs exist
        this.getOrbs(player.stageIndex);
      }
    }
    return result;
  }

  // After winning, restart the whole journey with a fresh, harder adventure.
  resetPlayerAdventure(player) {
    this.adventure++;             // bump room adventure -> new orb layouts & seeds
    this.orbsByStage.clear();     // regenerate all stages for the new adventure
    player.stageIndex = 0;
    player.points = 0;
    player.streak = 0;
    player.pos = { x: 0, y: 0, z: 0, ry: 0 };
    player.puzzleCache.clear();
    // keep coins, cosmetics, perks, totalScore and trophies
  }

  // Buy a shop item. Returns { ok, reason?, coins }.
  buyItem(player, item) {
    if (!item) return { ok: false, reason: 'no-item', coins: player.coins };
    const alreadyOwned = player.owned.includes(item.id);

    if (alreadyOwned) {
      // Already bought before. Perks stay active; cosmetics can be re-equipped
      // for free.
      if (item.type !== 'perk') player.cosmetics[item.type] = item.value;
      return { ok: true, equipped: true, coins: player.coins };
    }

    if (player.coins < item.cost) {
      return { ok: false, reason: 'too-poor', coins: player.coins };
    }

    player.coins -= item.cost;
    player.owned.push(item.id);
    if (item.type === 'perk') {
      if (!player.perks.includes(item.value)) player.perks.push(item.value);
    } else {
      player.cosmetics[item.type] = item.value;
    }
    return { ok: true, bought: true, coins: player.coins };
  }

  // Public snapshot for clients (no secrets like puzzle answers).
  snapshot() {
    return {
      code: this.code,
      adventure: this.adventure,
      players: [...this.players.values()].map(publicPlayer)
    };
  }

  leaderboard() {
    return [...this.players.values()]
      .map(p => ({ id: p.id, name: p.name, totalScore: p.totalScore, trophies: p.trophies, stageIndex: p.stageIndex }))
      .sort((a, b) => b.trophies - a.trophies || b.totalScore - a.totalScore);
  }
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, hero: p.hero, stageIndex: p.stageIndex,
    points: p.points, totalScore: p.totalScore, coins: p.coins,
    pos: p.pos, cosmetics: p.cosmetics, trophies: p.trophies, streak: p.streak,
    owned: p.owned, perks: p.perks
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// A registry of all live rooms.
export class RoomRegistry {
  constructor() { this.rooms = new Map(); }

  createRoom() {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  removeRoom(code) {
    this.rooms.delete(code);
  }
}
