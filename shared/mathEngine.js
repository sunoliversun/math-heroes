// Adaptive math puzzle generator for Math Heroes.
// Pure functions — deterministic when given a seeded RNG. Used by the server to
// generate authoritative puzzles per orb, and importable by tests.

import { STAGES, makeRng } from './config.js';

// Difficulty level 0..4 maps onto how big numbers get and which operations.
// `accuracy` (0..1) nudges the effective difficulty up or down so kids who are
// breezing through get harder questions and kids who struggle get easier ones.
export function effectiveLevel(stageIndex, accuracy = 0.5) {
  let lvl = stageIndex;
  if (accuracy >= 0.85) lvl += 1;       // doing great -> bump up
  else if (accuracy <= 0.4) lvl -= 1;   // struggling -> ease off
  return Math.max(0, Math.min(STAGES.length - 1, lvl));
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Build a single puzzle object: { id, question, answer, choices, skill }
export function generatePuzzle(seed, stageIndex, accuracy = 0.5) {
  const rng = makeRng(seed);
  const lvl = effectiveLevel(stageIndex, accuracy);
  const stage = STAGES[lvl] || STAGES[STAGES.length - 1];
  const skill = pick(rng, stage.skills);
  const max = stage.maxNumber;

  let question, answer;

  switch (skill) {
    case 'count': {
      const n = randInt(rng, 3, Math.min(10, max));
      const emoji = pick(rng, ['⭐', '🍎', '🐳', '🌸', '🚀', '🍪']);
      question = `How many?  ${emoji.repeat(n)}`;
      answer = n;
      break;
    }
    case 'add': {
      const a = randInt(rng, 1, max);
      const b = randInt(rng, 1, max);
      question = `${a} + ${b} = ?`;
      answer = a + b;
      break;
    }
    case 'sub': {
      const a = randInt(rng, 1, max);
      const b = randInt(rng, 0, a); // keep it non-negative for young kids
      question = `${a} − ${b} = ?`;
      answer = a - b;
      break;
    }
    case 'mul': {
      const a = randInt(rng, 1, Math.min(max, 12));
      const b = randInt(rng, 1, Math.min(max, 12));
      question = `${a} × ${b} = ?`;
      answer = a * b;
      break;
    }
    case 'div': {
      const b = randInt(rng, 1, Math.min(max, 12));
      const ans = randInt(rng, 1, Math.min(max, 12));
      const a = b * ans; // guarantee a whole-number answer
      question = `${a} ÷ ${b} = ?`;
      answer = ans;
      break;
    }
    case 'pattern': {
      const start = randInt(rng, 1, max);
      const step = randInt(rng, 1, 4);
      const seq = [start, start + step, start + 2 * step];
      answer = start + 3 * step;
      question = `What comes next?  ${seq.join(', ')}, ?`;
      break;
    }
    case 'fraction': {
      // Simple "what is half/third/quarter of N" style.
      const denom = pick(rng, [2, 3, 4]);
      const ans = randInt(rng, 1, Math.min(max, 12));
      const total = denom * ans;
      const word = { 2: 'half', 3: 'a third', 4: 'a quarter' }[denom];
      question = `What is ${word} of ${total}?`;
      answer = ans;
      break;
    }
    default: {
      const a = randInt(rng, 1, max);
      const b = randInt(rng, 1, max);
      question = `${a} + ${b} = ?`;
      answer = a + b;
    }
  }

  const choices = buildChoices(rng, answer);
  return {
    id: `pz_${seed}`,
    skill,
    question,
    answer,
    choices,
    level: lvl
  };
}

// Build 4 multiple-choice options including the correct answer, shuffled.
// Wrong answers are "near misses" so they're plausible but not silly.
export function buildChoices(rng, answer) {
  const set = new Set([answer]);
  let guard = 0;
  while (set.size < 4 && guard < 50) {
    guard++;
    const delta = randInt(rng, 1, Math.max(3, Math.ceil(answer * 0.5) || 3));
    const sign = rng() < 0.5 ? -1 : 1;
    let candidate = answer + sign * delta;
    if (candidate < 0) candidate = answer + delta; // no negative distractors
    if (candidate !== answer) set.add(candidate);
  }
  // Fallback fill in the rare case of collisions
  let extra = answer + 1;
  while (set.size < 4) { set.add(extra++); }

  const arr = [...set];
  // Fisher–Yates shuffle using the seeded rng
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Validate an answer (server-authoritative).
export function checkAnswer(puzzle, given) {
  return Number(given) === Number(puzzle.answer);
}
