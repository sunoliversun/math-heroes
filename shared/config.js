// Shared configuration for Math Heroes: The Five Realms.
// Imported by the server (Node ESM), the browser client, and the test suite.

// The five adventure stages, in order. Each is a distinct biome with its own
// look, point target to "graduate", and math difficulty band.
export const STAGES = [
  {
    id: 'desert',
    name: 'Sunscorch Desert',
    biome: 'desert',
    targetPoints: 60,
    orbCount: 8,
    // difficulty band: which math skills are unlocked here
    skills: ['count', 'add', 'sub'],
    maxNumber: 10,
    colors: { sky: '#ffce7a', ground: '#e3b269', fog: '#ffd89b', accent: '#c97f2d' },
    blurb: 'Cross the burning dunes! Solve sand puzzles to find water crystals.'
  },
  {
    id: 'swamp',
    name: 'Mistmarsh Swamp',
    biome: 'swamp',
    targetPoints: 75,
    orbCount: 9,
    skills: ['add', 'sub', 'pattern'],
    maxNumber: 20,
    colors: { sky: '#6f8f5e', ground: '#3f5a3a', fog: '#7d9b6a', accent: '#9bd17a' },
    blurb: 'Hop across the misty bog. Light the swamp lanterns with number magic.'
  },
  {
    id: 'rocky',
    name: 'Thunder Rocky Edge',
    biome: 'rocky',
    targetPoints: 90,
    orbCount: 10,
    skills: ['add', 'sub', 'mul'],
    maxNumber: 12,
    colors: { sky: '#9aa6b5', ground: '#6b6f78', fog: '#aeb6c2', accent: '#d98c3a' },
    blurb: 'Climb the cliffs of thunder. Power the crystals with multiplication!'
  },
  {
    id: 'forest',
    name: 'Whisperwood Forest',
    biome: 'forest',
    targetPoints: 105,
    orbCount: 11,
    skills: ['mul', 'div', 'pattern'],
    maxNumber: 12,
    colors: { sky: '#bfe3ff', ground: '#2f6b34', fog: '#cfeecb', accent: '#ffd34d' },
    blurb: 'Wander the giant trees. Free the glowing fireflies with division.'
  },
  {
    id: 'ice',
    name: 'Frostfall Ice Age',
    biome: 'ice',
    targetPoints: 120,
    orbCount: 12,
    skills: ['mul', 'div', 'fraction'],
    maxNumber: 12,
    colors: { sky: '#dff3ff', ground: '#dfeaf2', fog: '#eef9ff', accent: '#4db4ff' },
    blurb: 'Brave the frozen peaks. Claim the Golden Trophy at the summit!'
  }
];

export const FINAL_STAGE_INDEX = STAGES.length - 1;

// Points & coins economy
export const POINTS_PER_PUZZLE = 12;          // base points for a correct answer
export const STREAK_BONUS = 4;                // extra points per consecutive correct
export const COINS_PER_PUZZLE = 5;            // coins earned per correct answer
export const TROPHY_COIN_BONUS = 100;         // coins for winning the trophy

// Hero base characters (free)
export const HEROES = [
  { id: 'comet', name: 'Captain Comet', color: '#ff5d5d', power: 'Speed' },
  { id: 'aqua', name: 'Aqua Whiz', color: '#4db4ff', power: 'Splash' },
  { id: 'leaf', name: 'Leaf Spark', color: '#6fd66f', power: 'Vines' },
  { id: 'nova', name: 'Nova Bright', color: '#ffd34d', power: 'Glow' }
];

// Shop catalogue. Items are cosmetic or quality-of-life and bought with coins.
export const SHOP_ITEMS = [
  // Character colors
  { id: 'color_purple', type: 'color', name: 'Royal Purple', cost: 30, value: '#a45bff' },
  { id: 'color_pink',   type: 'color', name: 'Bubblegum Pink', cost: 30, value: '#ff7ad1' },
  { id: 'color_orange', type: 'color', name: 'Lava Orange', cost: 30, value: '#ff8c33' },
  { id: 'color_teal',   type: 'color', name: 'Ocean Teal', cost: 30, value: '#2ad0c0' },
  { id: 'color_gold',   type: 'color', name: 'Hero Gold', cost: 80, value: '#ffd700' },
  // Capes
  { id: 'cape_red',   type: 'cape', name: 'Crimson Cape', cost: 50, value: '#e23b3b' },
  { id: 'cape_blue',  type: 'cape', name: 'Sky Cape', cost: 50, value: '#3b7be2' },
  { id: 'cape_rainbow', type: 'cape', name: 'Rainbow Cape', cost: 150, value: 'rainbow' },
  // Hats
  { id: 'hat_crown',  type: 'hat', name: 'Golden Crown', cost: 120, value: 'crown' },
  { id: 'hat_wizard', type: 'hat', name: 'Wizard Hat', cost: 90, value: 'wizard' },
  { id: 'hat_cap',    type: 'hat', name: 'Cool Cap', cost: 40, value: 'cap' },
  // Trails (particle effect when moving)
  { id: 'trail_stars',  type: 'trail', name: 'Star Trail', cost: 70, value: 'stars' },
  { id: 'trail_fire',   type: 'trail', name: 'Fire Trail', cost: 70, value: 'fire' },
  { id: 'trail_hearts', type: 'trail', name: 'Heart Trail', cost: 70, value: 'hearts' },
  // Power-ups (consumable-style perks that persist for the run)
  { id: 'perk_hint',  type: 'perk', name: 'Hint Helper', cost: 60, value: 'hint',
    desc: 'Removes one wrong answer on every puzzle.' },
  { id: 'perk_boost', type: 'perk', name: 'Coin Booster', cost: 100, value: 'boost',
    desc: 'Earn +2 extra coins per puzzle.' }
];

// Movement / world tuning shared with the client
export const WORLD = {
  size: 60,            // half-extent of the playable square
  moveSpeed: 12,       // units per second
  jumpVelocity: 11,
  gravity: 26,
  orbReach: 3.2,       // how close you must be to a puzzle orb to open it
  trophyReach: 3.5
};

// A tiny deterministic PRNG (mulberry32) so server & client can generate the
// same world from the same seed. Returns a function -> float in [0,1).
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a string room code + stage + adventure number into a numeric seed.
export function seedFor(roomCode, stageIndex, adventure = 0) {
  const str = `${roomCode}:${stageIndex}:${adventure}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
