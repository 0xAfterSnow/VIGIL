import { describe, expect, it } from 'vitest';

import { CANDLE_COUNT, FINAL_THREE, LAST_LIT, type TicketId } from './constants';
import {
  BASE_BEAT_MS,
  buildTimeline,
  DEAD_TICKET_SPEED,
  fateLabel,
  NEAR_MISS_SLOWDOWN,
  pickSurvival,
  resolveDeathCount,
  TENSION_HOLD_MS,
} from './reveal';

/** Every permutation of the six death orders — the same 720 leaves the paytable enumerates. */
function allOrders(): number[][] {
  const orders: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      orders.push(prefix);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      walk([...prefix, rest[i]], rest.slice(0, i).concat(rest.slice(i + 1)));
    }
  };
  walk([], Array.from({ length: CANDLE_COUNT }, (_, c) => c));
  return orders;
}

/**
 * The timeline is a pure function of the death order, so a fixed stride through the 720 leaves
 * covers every shape it can take (first-out, survivor, near-miss, tension crossing) without paying
 * for the full enumeration in every assertion.
 */
const ORDERS = allOrders().filter((_, i) => i % 8 === 0);

describe('reveal timeline', () => {
  it('schedules one beat per snuff, in order, and never snuffs the survivor', () => {
    for (const order of ORDERS) {
      const timeline = buildTimeline(order, 2, LAST_LIT);
      expect(timeline.beats).toHaveLength(CANDLE_COUNT - 1);
      timeline.beats.forEach((beat, i) => {
        expect(beat.index).toBe(i);
        expect(beat.candle).toBe(order[i]);
        expect(beat.revealed).toBe(i + 1);
      });
      // The survivor (order[5]) is the one candle the vigil never puts out.
      const snuffed = timeline.beats.map(b => b.candle);
      expect(snuffed).toEqual(order.slice(0, CANDLE_COUNT - 1));
      expect(snuffed).not.toContain(order[CANDLE_COUNT - 1]);
    }
  });

  it('is strictly monotonic in time', () => {
    for (const order of ORDERS) {
      const { beats } = buildTimeline(order, 0, FINAL_THREE);
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i].landsAtMs).toBeGreaterThan(beats[i - 1].landsAtMs);
        expect(beats[i - 1].holdMs).toBeGreaterThan(0);
      }
    }
  });

  it('resolves LAST LIT on the 5th snuff and FINAL THREE on the 3rd', () => {
    for (const order of ORDERS) {
      const lastLit = buildTimeline(order, order[5], LAST_LIT);
      const finalThree = buildTimeline(order, order[5], FINAL_THREE);
      expect(lastLit.beats.filter(b => b.resolvesTicket)).toHaveLength(1);
      expect(lastLit.beats.find(b => b.resolvesTicket)?.revealed).toBe(5);
      expect(finalThree.beats.find(b => b.resolvesTicket)?.revealed).toBe(3);
      expect(resolveDeathCount(LAST_LIT)).toBe(5);
      expect(resolveDeathCount(FINAL_THREE)).toBe(3);
    }
  });

  it('runs the beats after your candle is out at half speed', () => {
    const order = [3, 0, 1, 2, 4, 5];
    const killedFirst = buildTimeline(order, 3, LAST_LIT);
    expect(killedFirst.beats[0].killsPick).toBe(true);
    // The killing beat itself is played at full tempo; everything after it is fast — plus the
    // resolve pre-hold on whichever of those beats settles the ticket.
    expect(killedFirst.beats[0].holdMs).toBeGreaterThanOrEqual(BASE_BEAT_MS);
    const fast = Math.round(BASE_BEAT_MS * DEAD_TICKET_SPEED);
    for (const beat of killedFirst.beats.slice(1)) {
      expect(beat.holdMs - fast).toBe(beat.resolvesTicket ? 250 : 0);
    }
  });

  it('holds slow motion only on a LAST LIT near-miss', () => {
    const order = [5, 4, 3, 2, 1, 0];
    const nearMiss = buildTimeline(order, 0, LAST_LIT);
    const final = nearMiss.beats[nearMiss.beats.length - 1];
    expect(final.slowMo).toBe(true);
    expect(final.holdMs).toBeGreaterThanOrEqual(Math.round(BASE_BEAT_MS * NEAR_MISS_SLOWDOWN));

    // The same candle on FINAL THREE is not a near-miss, and neither is an early death.
    expect(buildTimeline(order, 0, FINAL_THREE).beats.every(b => !b.slowMo)).toBe(true);
    expect(buildTimeline([0, 1, 2, 3, 4, 5], 0, LAST_LIT).beats.every(b => !b.slowMo)).toBe(true);
  });

  it('only ever adds the tension hold to a beat, never removes it', () => {
    for (const order of ORDERS) {
      for (const pick of order) {
        const { beats } = buildTimeline(order, pick, LAST_LIT);
        for (const beat of beats) {
          const withoutTension = beat.holdMs - (beat.tension ? TENSION_HOLD_MS : 0);
          expect(withoutTension).toBeGreaterThan(0);
        }
      }
    }
  });

  it(
    'keeps the worst case inside the 15 s budget, and turbo shortens every beat',
    () => {
      let worst = 0;
      for (const order of ORDERS) {
        for (const ticket of [LAST_LIT, FINAL_THREE] as TicketId[]) {
          for (const pick of order) {
            const normal = buildTimeline(order, pick, ticket);
            const turbo = buildTimeline(order, pick, ticket, { turbo: true });
            worst = Math.max(worst, normal.revealCompleteAtMs);
            expect(normal.revealCompleteAtMs).toBeLessThanOrEqual(15_000);
            expect(turbo.revealCompleteAtMs).toBeLessThan(normal.revealCompleteAtMs);
            for (let i = 0; i < normal.beats.length; i++) {
              expect(turbo.beats[i].holdMs).toBeLessThan(normal.beats[i].holdMs);
              expect(turbo.beats[i].candle).toBe(normal.beats[i].candle);
            }
          }
        }
      }
      // A full-tempo vigil is a real vigil: the slowest case is measured in seconds, not blinks.
      expect(worst).toBeGreaterThan(5_000);
    },
    30_000,
  );

  it('never reveals the outcome before the board is complete', () => {
    for (const order of ORDERS) {
      for (const pick of order) {
        const timeline = buildTimeline(order, pick, LAST_LIT);
        expect(timeline.resolveAtMs).toBeLessThanOrEqual(timeline.revealCompleteAtMs);
        // LAST LIT only resolves on the last snuff, so the two coincide there.
        expect(timeline.resolveAtMs).toBe(timeline.revealCompleteAtMs);
      }
    }
  });

  it('narrates how far the pick got', () => {
    const order = [3, 1, 0, 4, 2, 5];
    expect(pickSurvival(order, 3)).toEqual({ deathsBefore: 0, snuffedAt: 0 });
    expect(pickSurvival(order, 5)).toEqual({ deathsBefore: 5, snuffedAt: null });
    expect(fateLabel(order, 3)).toBe('THE 1ST OUT');
    expect(fateLabel(order, 5)).toBe('THE LAST LIT');
    expect(fateLabel(order, 2)).toBe('THE 5TH OUT');
    expect(fateLabel(order, 0)).toBe('THE 3RD OUT');
  });
});
