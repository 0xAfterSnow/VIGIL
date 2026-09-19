import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem';
import { CANDLE_COUNT, FINAL_THREE, LAST_LIT, type TicketId } from './constants';

/**
 * The wire format, mirroring `VigilGame`:
 *   gameData  = abi.encode(uint8 candle, uint8 ticket)                  — what the guest sends
 *   gameState = abi.encode(uint8[6] order, uint8 candle, uint8 ticket,
 *                          bool won, uint256 payout)                    — what the host returns
 * Both are static tuples, so they round-trip with `decodeAbiParameters` alone.
 */

const GAME_DATA_PARAMS = [{ type: 'uint8' }, { type: 'uint8' }] as const;
const GAME_STATE_PARAMS = [
  { type: 'uint8[6]' },
  { type: 'uint8' },
  { type: 'uint8' },
  { type: 'bool' },
  { type: 'uint256' },
] as const;

export type VigilBet = { candle: number; ticket: TicketId };

export type VigilSettled = {
  /** Death order, first to die first. */
  order: number[];
  candle: number;
  ticket: TicketId;
  won: boolean;
  payout: bigint;
};

export function encodeGameData(bet: VigilBet): Hex {
  return encodeAbiParameters(GAME_DATA_PARAMS, [bet.candle, bet.ticket]);
}

export function decodeGameData(gameData: Hex | undefined): VigilBet | null {
  if (!gameData) return null;
  try {
    const [candle, ticket] = decodeAbiParameters(GAME_DATA_PARAMS, gameData);
    if (candle >= CANDLE_COUNT || (ticket !== LAST_LIT && ticket !== FINAL_THREE)) return null;
    return { candle, ticket: ticket as TicketId };
  } catch {
    return null;
  }
}

export function encodeGameState(settled: VigilSettled): Hex {
  return encodeAbiParameters(GAME_STATE_PARAMS, [
    settled.order as [number, number, number, number, number, number],
    settled.candle,
    settled.ticket,
    settled.won,
    settled.payout,
  ]);
}

/**
 * Decode the settled blob. Returns `null` while the round is still pending: `onSessionStart`
 * writes an all-zero order, which is not a permutation, so a pending state is never mistaken for a
 * settled loss.
 */
export function decodeGameState(gameState: Hex | undefined): VigilSettled | null {
  if (!gameState || gameState === '0x') return null;
  try {
    const [order, candle, ticket, won, payout] = decodeAbiParameters(
      GAME_STATE_PARAMS,
      gameState,
    );
    if (order.length !== CANDLE_COUNT) return null;
    if (!order.every(c => c < CANDLE_COUNT)) return null;
    if (new Set(order).size !== CANDLE_COUNT) return null;
    if (candle >= CANDLE_COUNT || (ticket !== LAST_LIT && ticket !== FINAL_THREE)) return null;
    return {
      order: [...order].map(Number),
      candle: Number(candle),
      ticket: ticket as TicketId,
      won,
      payout,
    };
  } catch {
    return null;
  }
}

/** `ORDER ID` for the result card: the death order as six digits, e.g. `4-2-6-1-3-5`. */
export function orderId(order: readonly number[]): string {
  return order.map(c => c + 1).join('-');
}

/** Compact base-36 form of the same order, for sharing. */
export function orderCode(order: readonly number[]): string {
  const digits: number[] = [];
  for (let i = 0; i < CANDLE_COUNT; i += 2) {
    digits.push(order[i] * 6 + order[i + 1]);
  }
  return digits
    .map(d => d.toString(36))
    .join('')
    .toUpperCase();
}
