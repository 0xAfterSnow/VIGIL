import { describe, expect, it } from 'vitest';
import golden from './golden.json';
import { sampleOrder, windowAt } from './sampler';
import { isWin, maxMultiplierBps, numerator, payoutFor, probability } from './payout';
import { D, LAST_NUM, FINAL3_NUM } from './constants';

/**
 * PRD §9 test 6 (client↔contract parity, fixture half) and test 3 (paytable, client side).
 *
 * `golden.json` is GENERATED from the deployed VigilGame by `test/generate-golden.ts`
 * (`deriveOrder`, `payoutFor`, `maxMultiplierBps` on chain), so if the client's TS mirror ever
 * drifts from the contract this test fails. Regenerate with
 * `npx tsx test/generate-golden.ts --count=200`.
 */

const g = golden as {
  generatedFrom: string;
  words: string[];
  orders: number[][];
  payouts: { wager: string; candle: number; ticket: number; win: boolean; payout: string }[];
  multipliers: { candle: number; ticket: number; bps: string }[];
};

describe('PRD §9 test 6 — client sampler matches the on-chain sampler', () => {
  it('reproduces the contract death order for every golden word', () => {
    expect(g.words.length).toBeGreaterThanOrEqual(200);
    for (let i = 0; i < g.words.length; i++) {
      const got = sampleOrder(g.words[i] as `0x${string}`);
      expect(got).toEqual(g.orders[i]);
    }
  });

  it('matches the contract payout table on every golden payout', () => {
    for (const row of g.payouts) {
      expect(
        payoutFor(BigInt(row.wager), row.candle, row.ticket as 0 | 1, row.win),
      ).toBe(BigInt(row.payout));
    }
  });

  it('matches the contract ceiling multipliers exactly', () => {
    for (const row of g.multipliers) {
      expect(maxMultiplierBps(row.candle, row.ticket as 0 | 1)).toBe(BigInt(row.bps));
    }
  });

  it('covers all 12 tickets with the known 96% values', () => {
    for (let candle = 0; candle < 6; candle++) {
      expect(payoutFor(10n ** 18n, candle, 0, true)).toBe(
        (10n ** 18n * 96n * D) / (100n * LAST_NUM[candle]),
      );
      expect(payoutFor(10n ** 18n, candle, 1, true)).toBe(
        (10n ** 18n * 96n * D) / (100n * FINAL3_NUM[candle]),
      );
    }
  });

  it('is deterministic and window-aligned (a fresh Uint8Array view changes nothing)', () => {
    const word = g.words[7] as `0x${string}`;
    expect(sampleOrder(word)).toEqual(sampleOrder(word));
    expect(windowAt(word, 0)).toBe(windowAt(word, 0));
  });
});

describe('PRD §9 test 3 — the client payout is the exact 96% integer (fixture half)', () => {
  it('every win payout equals floor(wager * 96 * D / (100 * NUM))', () => {
    for (const row of g.payouts) {
      if (!row.win) {
        expect(BigInt(row.payout)).toBe(0n);
        continue;
      }
      const wager = BigInt(row.wager);
      const num = numerator(row.ticket as 0 | 1, row.candle);
      expect(BigInt(row.payout)).toBe((wager * 96n * D) / (100n * num));
    }
  });

  it('sums and ratios still hold on the client side (test 1 mirror)', () => {
    let sumLast = 0n;
    let sumFinal = 0n;
    for (let c = 0; c < 6; c++) {
      sumLast += numerator(0, c);
      sumFinal += numerator(1, c);
    }
    expect(sumLast).toBe(D);
    expect(sumFinal).toBe(3n * D);
  });
});
