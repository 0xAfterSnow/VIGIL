import { encodeAbiParameters, hexToBytes, keccak256, type Hex } from 'viem';
import {
  CANDLE_COUNT,
  LIT_MASK_ALL,
  WINDOW_DOMAIN,
  WINDOWS_PER_WORD,
} from './constants';

/**
 * The VIGIL sampler, mirroring `VigilGame._sampleOrder` bit for bit.
 *
 * Six sequential weighted draws without replacement: for the draw whose remaining total weight is
 * `W`, take the next unused 16-bit window `v`; reject it when `v >= floor(65536 / W) * W` and take
 * the next window instead; otherwise `r = v % W`. `%` only ever runs *after* the rejection test —
 * never a bare `byte % n` (see the SDK's `RANDOMNESS_DICE.md`).
 */
export type Randomness = Hex | Uint8Array;

const bytesOf = (randomness: Randomness): Uint8Array =>
  typeof randomness === 'string' ? hexToBytes(randomness) : randomness;

/** Sum of the death weights of the candles still lit (candle `c` has weight `c + 1`). */
export function maskWeight(mask: number): number {
  let total = 0;
  for (let c = 0; c < CANDLE_COUNT; c++) {
    if (mask & (1 << c)) total += c + 1;
  }
  return total;
}

/**
 * Cumulative-weight mapper: the candle in `survivorsMask` whose interval contains `r`, scanning
 * ascending index. Candle `c` owns exactly `d_c = c + 1` of the values — this is why the sampler is
 * exact rather than approximate.
 */
export function mapDraw(survivorsMask: number, r: number): number {
  let remaining = r;
  for (let c = 0; c < CANDLE_COUNT; c++) {
    if ((survivorsMask & (1 << c)) === 0) continue;
    const weight = c + 1;
    if (remaining < weight) return c;
    remaining -= weight;
  }
  throw new Error(`mapDraw: r=${r} out of range for mask ${survivorsMask}`);
}

const wordCache = new WeakMap<Uint8Array, Map<number, Uint8Array>>();

/** `keccak256(abi.encode(randomness, blockIndex))` — the contract's stream expansion. */
function expandBlock(word: Uint8Array, blockIndex: number): Uint8Array {
  let perWord = wordCache.get(word);
  if (!perWord) {
    perWord = new Map();
    wordCache.set(word, perWord);
  }
  const cached = perWord.get(blockIndex);
  if (cached) return cached;

  const expanded = hexToBytes(
    keccak256(
      encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [
        `0x${Buffer.from(word).toString('hex')}` as Hex,
        BigInt(blockIndex),
      ]),
    ),
  );
  perWord.set(blockIndex, expanded);
  return expanded;
}

/** The `cursor`-th 16-bit window of the expanded stream (big-endian byte pairs). */
export function windowAt(randomness: Randomness, cursor: number): number {
  const word = bytesOf(randomness);
  const blockIndex = Math.floor(cursor / WINDOWS_PER_WORD);
  const byteOffset = (cursor % WINDOWS_PER_WORD) * 2;
  const block = blockIndex === 0 ? word : expandBlock(word, blockIndex);
  return (block[byteOffset] << 8) | block[byteOffset + 1];
}

/**
 * The death order the word decides: `[0]` dies first, `[5]` is the survivor.
 * Identical to `VigilGame._sampleOrder` / `deriveOrder(bytes32)`.
 */
export function sampleOrder(randomness: Randomness): number[] {
  const order: number[] = [];
  let litMask = LIT_MASK_ALL;
  let cursor = 0;

  for (let i = 0; i < CANDLE_COUNT; i++) {
    const totalWeight = maskWeight(litMask);
    const limit = Math.floor(WINDOW_DOMAIN / totalWeight) * totalWeight;
    let value = windowAt(randomness, cursor);
    cursor += 1;
    while (value >= limit) {
      value = windowAt(randomness, cursor);
      cursor += 1;
    }
    const candle = mapDraw(litMask, value % totalWeight);
    order.push(candle);
    litMask &= ~(1 << candle);
  }
  return order;
}