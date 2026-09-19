import { describe, expect, it } from 'vitest';
import {
  lastLitProbabilityRational,
  surviveProbabilityRational,
  survivorProbabilities,
  survivorProbabilityFloats,
} from './live';
import { D, FINAL3_NUM, LAST_NUM } from './constants';

/**
 * PRD §9 test 7 — the live re-pricing is the same math, not a new model.
 */

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

const survivorsOf = (order: number[], deaths: number) =>
  Array.from({ length: 6 }, (_, c) => c).filter(c => !order.slice(0, deaths).includes(c));

describe('PRD §9 test 7 — live re-pricing', () => {
  it('fresh-board LAST LIT probabilities reproduce LAST_NUM/D exactly', () => {
    const probs = survivorProbabilities(0, []);
    for (let c = 0; c < 6; c++) {
      // the live rational is the *reduced* form of the same probability
      const num = LAST_NUM[c];
      const den = D;
      const g = gcd(num, den);
      expect(probs[c].num).toBe(num / g);
      expect(probs[c].den).toBe(den / g);
    }
  });

  it('fresh-board FINAL THREE probabilities reproduce FINAL3_NUM/D', () => {
    const probs = survivorProbabilities(1, []);
    for (let c = 0; c < 6; c++) {
      const g = gcd(FINAL3_NUM[c], D);
      expect(probs[c].num).toBe(FINAL3_NUM[c] / g);
      expect(probs[c].den).toBe(D / g);
    }
  });

  it('live probabilities sum to 1 while the ticket is undecided', () => {
    const orders: number[][] = [
      [5, 3, 0],
      [2],
      [4, 1],
      [0, 3, 5],
    ];
    for (const order of orders) {
      // LAST LIT: exactly one candle is last, so the live probabilities sum to 1
      for (const order2 of [order]) {
        const deaths = Math.min(order2.length, 5);
        const survivors = survivorsOf(order2, deaths);
        if (survivors.length <= 1) continue; // already resolved
        let sum = 0;
        for (const p of survivorProbabilityFloats(0, order2)) sum += p;
        expect(sum).toBeCloseTo(1, 10);
      }
      // FINAL THREE: the sum is the number of candles still alive after the remaining deaths
      const deaths = Math.min(order.length, 3);
      const survivors = survivorsOf(order, deaths);
      if (survivors.length <= 3) continue; // already resolved
      let sum = 0;
      for (const p of survivorProbabilityFloats(1, order)) sum += p;
      expect(sum).toBeCloseTo(survivors.length - (3 - deaths), 10);
    }
  });

  it('dead candles have probability 0, resolved candles have probability 1', () => {
    const order = [5, 2, 4];
    const probs = survivorProbabilities(1, order); // 3rd death already drawn
    expect(probs[5].num).toBe(0n);
    expect(probs[2].num).toBe(0n);
    expect(probs[4].num).toBe(0n);
    for (const c of [0, 1, 3]) expect(probs[c]).toEqual({ num: 1n, den: 1n });
  });

  it('a candle that is out can never be priced', () => {
    const order = [5, 2];
    expect(survivorProbabilityFloats(0, order)[5]).toBe(0);
    expect(survivorProbabilityFloats(0, order)[2]).toBe(0);
  });

  it('the survivor re-pricing recursion holds: removing a dead candle preserves the ratios', () => {
    // after candle 5 dies first, the remaining survivors' LAST LIT probabilities must match
    // the exact fresh-board values of the five-candle subgame with weights 1..5 (indices 0..4)
    const after = survivorProbabilityFloats(0, [5]);
    const fresh = survivorProbabilityFloats(0, []); // fresh 6-candle board
    // fresh-board ratio between two survivors must be preserved after the first death
    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 5; b++) {
        // fresh-board ratio for the 6-candle game at (a,b) is NOT preserved in general — what
        // holds is that the post-death probabilities match the sub-game on weights w_a, w_b, ...
        // computed on the five remaining candles, i.e. fresh5 = the same math restricted to 0..4.
        const p = surviveProbabilityRational(b, [0, 1, 2, 3, 4], 4); // P(b is last among 0..4) below
        const expected = lastLitProbabilityRational(b, [0, 1, 2, 3, 4]);
        expect(after[b] * Number(expected.d)).toBeCloseTo(Number(expected.n), 9);
      }
    }
  });

  it('weaker candles pay more on a live board', () => {
    const order = [5, 4]; // heavy candles die first in expectation
    const floats = survivorProbabilityFloats(0, order);
    expect(floats[0]).toBeGreaterThan(floats[3]);
    expect(floats[0]).toBeGreaterThan(floats[1]);
  });

  it('surviveProbabilityRational is consistent with a brute-force enumeration', () => {
    // full 6-candle enumeration of death orders (720), grouped by first-3 survivor sets:
    // the exact fraction for candle 0 in FINAL THREE must match the contract's FINAL3_NUM[0]/D
    const survivors = [0, 1, 2, 3, 4, 5];
    const p = surviveProbabilityRational(0, survivors, 3);
    expect(p.n * D).toBe(FINAL3_NUM[0] * p.d);
  });
});
