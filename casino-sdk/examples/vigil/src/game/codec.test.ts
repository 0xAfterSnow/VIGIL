import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem';
import { decodeGameData, decodeGameState, encodeGameData, encodeGameState, orderId, type VigilSettled } from './codec';

const GAME_STATE_PARAMS = [
  { type: 'uint8[6]' },
  { type: 'uint8' },
  { type: 'uint8' },
  { type: 'bool' },
  { type: 'uint256' },
] as const;

const BET = { candle: 4, ticket: 1 };

describe('PRD §9 test 6 — codec round-trip', () => {
  it('gameData round-trips and matches the contract ABI byte for byte', () => {
    const data = encodeGameData(BET);
    // abi.encode(uint8,uint8): candle in the first slot, ticket in the second
    expect(data).toBe(
      '0x00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000001',
    );
    expect(decodeGameData(data)).toEqual(BET);
    for (let candle = 0; candle < 6; candle++) {
      for (const ticket of [0, 1] as const) {
        expect(decodeGameData(encodeGameData({ candle, ticket }))).toEqual({ candle, ticket });
      }
    }
  });

  it('rejects malformed / hostile gameData instead of crashing', () => {
    expect(decodeGameData(undefined)).toBeNull();
    expect(decodeGameData('0x' as Hex)).toBeNull();
    expect(decodeGameData('0xdead')).toBeNull();
    expect(decodeGameData(encodeGameData({ candle: 6, ticket: 0 }))).toBeNull();
    expect(decodeGameData(encodeGameData({ candle: 0, ticket: 2 }))).toBeNull();
    expect(decodeGameData(encodeGameData({ candle: 255, ticket: 0 }))).toBeNull();
  });

  it('gameState round-trips the settled blob', () => {
    const settled: VigilSettled = {
      order: [4, 2, 0, 5, 1, 3],
      candle: 3,
      ticket: 1,
      won: true,
      payout: 123456789n,
    };
    expect(decodeGameState(encodeGameState(settled))).toEqual(settled);
  });

  it('a pending all-zero state is not mistaken for a settled loss', () => {
    // onSessionStart writes an all-zero order while the round is pending
    const pending = encodeAbiParameters(GAME_STATE_PARAMS, [[0, 0, 0, 0, 0, 0], 0, 0, false, 0n]);
    expect(decodeGameState(pending)).toBeNull();
    expect(decodeGameState('0x')).toBeNull();
  });

  it('rejects a gameState whose order is not a permutation', () => {
    const dupe = encodeAbiParameters(GAME_STATE_PARAMS, [[1, 1, 2, 3, 4, 5], 0, 0, true, 5n]);
    expect(decodeGameState(dupe)).toBeNull();
  });

  it('renders the human order id', () => {
    expect(orderId([4, 2, 0, 5, 1, 3])).toBe('5-3-1-6-2-4');
  });
});
