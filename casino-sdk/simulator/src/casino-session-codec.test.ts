import { describe, expect, it } from 'vitest';

import {
  CasinoSessionCodecError,
  decodeCasinoSession,
  encodeCasinoSession,
  type CasinoSessionSnapshot,
} from './casino-session-codec';

const OPERATOR_OFFSET = 235;
const FIXED_LENGTH = 255;

const session: CasinoSessionSnapshot = {
  sessionId: '7',
  player: '0x00000000000000000000000000000000000000aa',
  vault: '0x00000000000000000000000000000000000000bb',
  game: '0x00000000000000000000000000000000000000cc',
  token: '0x00000000000000000000000000000000000000dd',
  wagerBase: '1000',
  escrowedStake: '1000',
  reservedProfit: '980',
  maxEscrowStake: '2000',
  maxReservedProfit: '980',
  deadlineBlock: '43215',
  step: 1,
  phase: 1,
  riskMaxPayout: '1980',
  riskProbabilityWad: '490000000000000000',
  riskSubVarianceScaled: '12345',
  riskHeavyTail: false,
  riskHighMultiplierFloor: true,
  operator: '0x00000000000000000000000000000000000000ee',
  gameData: '0x01',
  gameState: '0xabcdef',
};

const bytesAt = (encoded: string, start: number, end: number) =>
  `0x${encoded.slice(2 + start * 2, 2 + end * 2)}`;

describe('casino session codec', () => {
  it('round-trips a session', () => {
    expect(decodeCasinoSession(encodeCasinoSession(session))).toEqual(session);
  });

  it('packs the operator after the flags, right before the game data length', () => {
    const encoded = encodeCasinoSession(session);

    expect(bytesAt(encoded, OPERATOR_OFFSET, FIXED_LENGTH)).toBe(session.operator);
    expect(bytesAt(encoded, FIXED_LENGTH, FIXED_LENGTH + 2)).toBe('0x0001');
  });

  it('rejects a snapshot from the pre-operator layout', () => {
    const encoded = encodeCasinoSession(session);
    const withoutOperator = `0x${encoded.slice(2, 2 + OPERATOR_OFFSET * 2)}${encoded.slice(2 + FIXED_LENGTH * 2)}`;

    expect(() => decodeCasinoSession(withoutOperator)).toThrow(CasinoSessionCodecError);
  });
});
