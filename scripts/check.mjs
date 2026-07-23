import assert from 'node:assert/strict';
import { staged } from '../src/scrollExplode.js';

// staged() is the scroll remap: monotonic, spans 0..1, and parks during holds.
const S = 5, H = 0.42;
const at = p => staged(p, S, H);

assert.equal(at(0), 0, 'starts at 0');
assert.ok(Math.abs(at(1) - 1) < 1e-6, 'reaches 1');

// monotonic, never leaves [0,1]
let prev = -1;
for (let i = 0; i <= 1000; i++) {
  const v = at(i / 1000);
  assert.ok(v >= prev - 1e-9, `monotonic at ${i / 1000}`);
  assert.ok(v >= 0 && v <= 1, `in range at ${i / 1000}`);
  prev = v;
}

// the hold actually holds: first 42% of a stage must not move at all
const stage0 = at(0), stage0end = at((H - 0.01) / S);
assert.equal(stage0, stage0end, 'hold is flat');

// and the handoff actually moves: the rest of the stage covers a full 1/S
assert.ok(Math.abs(at(1 / S) - 1 / S) < 1e-6, 'stage boundary lands on 1/stages');

// out-of-range input is clamped, not NaN
assert.equal(at(-0.5), 0, 'negative clamps to 0');
assert.ok(Number.isFinite(at(1.5)), 'over-scroll stays finite');

console.log('staged() ok');
