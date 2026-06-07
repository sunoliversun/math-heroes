import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePuzzle, buildChoices, checkAnswer, effectiveLevel
} from '../shared/mathEngine.js';
import { makeRng, STAGES } from '../shared/config.js';

test('generatePuzzle is deterministic for the same seed', () => {
  const a = generatePuzzle(12345, 0, 0.5);
  const b = generatePuzzle(12345, 0, 0.5);
  assert.deepEqual(a, b);
});

test('different seeds give different puzzles (usually)', () => {
  const seen = new Set();
  for (let s = 0; s < 30; s++) seen.add(generatePuzzle(s, 2, 0.5).question);
  assert.ok(seen.size > 10, 'should produce variety');
});

test('every puzzle has exactly 4 unique choices including the answer', () => {
  for (let s = 0; s < 200; s++) {
    for (let stage = 0; stage < STAGES.length; stage++) {
      const p = generatePuzzle(s * 7 + stage, stage, 0.5);
      assert.equal(p.choices.length, 4, `4 choices (seed ${s}, stage ${stage})`);
      assert.equal(new Set(p.choices).size, 4, `unique choices (seed ${s}, stage ${stage})`);
      assert.ok(p.choices.includes(p.answer), `answer present (seed ${s}, stage ${stage})`);
    }
  }
});

test('answers are always non-negative whole numbers', () => {
  for (let s = 0; s < 300; s++) {
    for (let stage = 0; stage < STAGES.length; stage++) {
      const p = generatePuzzle(s, stage, 0.5);
      assert.ok(Number.isInteger(p.answer), 'integer answer');
      assert.ok(p.answer >= 0, `non-negative answer got ${p.answer}`);
      p.choices.forEach(c => assert.ok(c >= 0, 'no negative distractors'));
    }
  }
});

test('division puzzles always yield whole-number answers', () => {
  let found = 0;
  for (let s = 0; s < 1000 && found < 20; s++) {
    const p = generatePuzzle(s, 4, 0.5); // ice stage includes div
    if (p.skill === 'div') {
      found++;
      assert.ok(Number.isInteger(p.answer));
      // verify the math in the question
      const m = p.question.match(/(\d+) ÷ (\d+)/);
      assert.ok(m, 'parse division');
      assert.equal(Number(m[1]) / Number(m[2]), p.answer);
    }
  }
  assert.ok(found > 0, 'should generate some division puzzles');
});

test('subtraction never goes negative', () => {
  let found = 0;
  for (let s = 0; s < 800; s++) {
    const p = generatePuzzle(s, 1, 0.3);
    if (p.skill === 'sub') {
      found++;
      const m = p.question.match(/(\d+) − (\d+)/);
      if (m) assert.ok(Number(m[1]) >= Number(m[2]), 'minuend >= subtrahend');
    }
  }
  assert.ok(found > 0);
});

test('checkAnswer validates correctly', () => {
  const p = generatePuzzle(99, 0, 0.5);
  assert.equal(checkAnswer(p, p.answer), true);
  assert.equal(checkAnswer(p, p.answer + 1), false);
  assert.equal(checkAnswer(p, String(p.answer)), true, 'string coercion works');
});

test('effectiveLevel adapts to accuracy and clamps', () => {
  assert.equal(effectiveLevel(2, 0.9), 3, 'high accuracy bumps up');
  assert.equal(effectiveLevel(2, 0.2), 1, 'low accuracy eases off');
  assert.equal(effectiveLevel(2, 0.6), 2, 'mid accuracy stays');
  assert.equal(effectiveLevel(0, 0.1), 0, 'clamps at 0');
  assert.equal(effectiveLevel(4, 0.99), 4, 'clamps at max');
});

test('buildChoices fills 4 even for small answers', () => {
  const rng = makeRng(1);
  const choices = buildChoices(rng, 0);
  assert.equal(choices.length, 4);
  assert.ok(choices.includes(0));
  choices.forEach(c => assert.ok(c >= 0));
});

test('count puzzles produce answer between 3 and 10', () => {
  let found = 0;
  for (let s = 0; s < 500; s++) {
    const p = generatePuzzle(s, 0, 0.5);
    if (p.skill === 'count') { found++; assert.ok(p.answer >= 3 && p.answer <= 10); }
  }
  assert.ok(found > 0);
});
