/**
 * VIGIL constants — the exact values `vigil_math.py` prints and `VigilGame.sol` hard-codes.
 * Nothing here is derived; it is all checked against the contract in `parity.test.ts`.
 */

/** Six candles, index 0..5. Death weight of candle `c` is `c + 1`. */
export const CANDLE_COUNT = 6;

/** Death weights: higher means more likely to be snuffed early. */
export const DEATH_WEIGHTS: readonly number[] = [1, 2, 3, 4, 5, 6];

/** Common denominator of all 720 exact order probabilities. */
export const D = 2053230379200n;

/** `P(candle is last lit) = LAST_NUM[candle] / D`. Sums to `D`. */
export const LAST_NUM: readonly bigint[] = [
  1084606372080n,
  458051106240n,
  236773817280n,
  136008421920n,
  83680014600n,
  54110647080n,
];

/** `P(candle survives the first 3 deaths) = FINAL3_NUM[candle] / D`. Sums to `3 * D`. */
export const FINAL3_NUM: readonly bigint[] = [
  1682359451640n,
  1353394178640n,
  1072234928520n,
  843998712480n,
  669859331400n,
  537844534920n,
];

export const RTP_PERCENT = 96n;
export const PERCENT = 100n;
export const PROBABILITY_WAD = 10n ** 18n;

export const LAST_LIT = 0;
export const FINAL_THREE = 1;
export type TicketId = typeof LAST_LIT | typeof FINAL_THREE;

export type Ticket = {
  id: TicketId;
  label: string;
  /** Resolves at this many deaths. */
  resolvesAt: number;
  oneLiner: string;
};

export const TICKETS: readonly Ticket[] = [
  {
    id: LAST_LIT,
    label: 'LAST LIT',
    resolvesAt: 5,
    oneLiner: 'your candle is the last flame',
  },
  {
    id: FINAL_THREE,
    label: 'FINAL THREE',
    resolvesAt: 3,
    oneLiner: 'your candle outlasts three others',
  },
];

/** RTP as a display string; also the declared figure on the jam submission form. */
export const RTP_LABEL = '96%';

// ---------------------------------------------------------------- sampler domain

/**
 * The random word is read as sixteen 16-bit windows. When the stream runs past a word's sixteen
 * windows, the next block is `keccak256(abi.encode(word, blockIndex))` — exactly the contract's
 * `_windowAt`. Worst-case per-window rejection probability in play is 4/65536 ≈ 0.006%.
 */
export const WINDOW_DOMAIN = 1 << 16;
export const WINDOWS_PER_WORD = 16;
export const LIT_MASK_ALL = 0b111111;

/** FIFTEEN characters is the widest label used on the candle (36.4272x → 7 chars). */
export const MAX_MULTIPLIER_LABEL = '36.4272';
