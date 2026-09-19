import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Hex } from 'viem';

import { SessionPhase, type HostSnapshotV1 } from '@chain/casino-sdk/guest';

import { decodeGameData, encodeGameData, encodeGameState, type VigilBet } from '../game/codec';
import { isWin, payoutFor } from '../game/payout';
import { sampleOrder } from '../game/sampler';

/**
 * The standalone free-play host (PRD §5.4).
 *
 * Opened outside the chain.wtf iframe — on the jam entry's own domain, or from a bookmark — VIGIL
 * is still a playable game. This module stands in for the casino host: it keeps a demo-chip
 * balance, opens a session on `openSession`, decides the death order with the *same* sampler the
 * contract uses, settles with the *same* `payoutFor` the contract pays with, and pushes a
 * `HostSnapshotV1` in exactly the shape the real host does — so the game itself has one code path
 * and no idea which host it is talking to.
 *
 * What it is not: provably fair. The word comes from `crypto.getRandomValues`, not from a VRF, and
 * the chips are not money. Both are stated on screen (the bottom bar, the balance row) rather than
 * buried here.
 */

/**
 * A stand-in game address (valid hex, distinctive) so the history rail filters to the demo's own
 * rounds and never mixes them with a real deployment's.
 */
const DEMO_GAME_ADDRESS = '0x0000000000000000000000000000000000dec0de';
const DEMO_PLAYER = '0x0000000000000000000000000000000000dec0de';
const DEMO_SYMBOL = 'CHIP';
const DEMO_DECIMALS = 18;
const ONE_CHIP = 10n ** BigInt(DEMO_DECIMALS);

export const DEMO_START_CHIPS = 1000n * ONE_CHIP;
/** Below this the player is offered a refill, so a losing streak can never dead-end the demo. */
export const DEMO_REFILL_BELOW = 10n * ONE_CHIP;

/** A beat of "the candles burn" before the demo settles, so the round has the host's shape. */
const SETTLE_DELAY_MS = 900;
const MAX_HISTORY = 12;

const DEMO_MANIFEST: HostSnapshotV1['integration']['manifest'] = {
  schemaVersion: 1,
  apiVersion: 1,
  gameId: 'vigilgame',
  defaultLocale: 'en',
  locales: {
    en: {
      name: 'VIGIL (free play)',
      description: 'Free-play demo: demo chips, simulated randomness, the same sampler and paytable.',
    },
  },
};

type DemoSession = {
  sessionId: string;
  sessionKey: string;
  bet: VigilBet;
  wager: bigint;
  word: Hex;
  order: number[];
  won: boolean;
  payout: bigint;
  settled: boolean;
  /** The payout has been released into the balance (mirrors the host's reveal gate). */
  credited: boolean;
  at: number;
};

export type DemoHost = {
  hostApi: {
    openSession(input: { wager: string; gameData: Hex }): Promise<{ sessionKey: string; transactionHash: Hex }>;
    revealOutcome(input: { sessionId: string }): Promise<void>;
  };
  snapshot: HostSnapshotV1;
  /** Tops the demo balance back up. */
  refill: () => void;
  /** True when the balance is low enough that a refill is offered. */
  low: boolean;
};

function randomWord(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

export function useDemoHost(): DemoHost {
  const [balance, setBalance] = useState<bigint>(DEMO_START_CHIPS);
  const [sessions, setSessions] = useState<DemoSession[]>([]);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(
    () => () => {
      timers.current.forEach(id => window.clearTimeout(id));
      timers.current = [];
    },
    [],
  );

  const openSession = useCallback(async (input: { wager: string; gameData: Hex }) => {
    const bet = decodeGameData(input.gameData);
    if (!bet) throw new Error('That bet is not a VIGIL bet.');
    let wager: bigint;
    try {
      wager = BigInt(input.wager);
    } catch {
      throw new Error('That wager is not a number.');
    }
    if (wager <= 0n) throw new Error('The wager must be positive.');

    const sessionId = String(++counter.current);
    const sessionKey = `demo:${sessionId}`;
    const word = randomWord();
    const order = sampleOrder(word);
    const won = isWin(order, bet.candle, bet.ticket);
    const payout = payoutFor(wager, bet.candle, bet.ticket, won);

    // The stake leaves the balance at open, the payout only lands on `revealOutcome` — the same
    // ordering the real host enforces, so the reveal can never be spoiled by the balance.
    setBalance(current => (current >= wager ? current - wager : current));
    setSessions(current =>
      [
        {
          sessionId,
          sessionKey,
          bet,
          wager,
          word,
          order,
          won,
          payout,
          settled: false,
          credited: false,
          at: Date.now(),
        },
        ...current,
      ].slice(0, MAX_HISTORY),
    );

    timers.current.push(
      window.setTimeout(() => {
        setSessions(current =>
          current.map(row =>
            row.sessionKey === sessionKey ? { ...row, settled: true, at: Date.now() } : row,
          ),
        );
      }, SETTLE_DELAY_MS),
    );

    return { sessionKey, transactionHash: '0x' as Hex };
  }, []);

  const revealOutcome = useCallback(async ({ sessionId }: { sessionId: string }) => {
    const row = sessionsRef.current.find(session => session.sessionId === sessionId);
    if (!row || !row.won || row.credited || row.payout <= 0n) return;
    setSessions(current =>
      current.map(s => (s.sessionKey === row.sessionKey ? { ...s, credited: true } : s)),
    );
    setBalance(current => current + row.payout);
  }, []);

  const refill = useCallback(() => setBalance(current => current + DEMO_START_CHIPS), []);

  const snapshot = useMemo<HostSnapshotV1>(
    () => ({
      apiVersion: 1,
      integration: {
        chainId: 0,
        slug: 'vigil-free-play',
        gameAddress: DEMO_GAME_ADDRESS,
        manifest: DEMO_MANIFEST,
      },
      wallet: { status: 'ready', address: DEMO_PLAYER, smartVaultAddress: DEMO_PLAYER },
      token: { symbol: DEMO_SYMBOL, decimals: DEMO_DECIMALS },
      balances: { smartVaultBalance: balance.toString() },
      casino: {
        // The demo keeps the house's shape: 100 chips a bet, 250 chips of reserved profit.
        maxBetAmount: (100n * ONE_CHIP).toString(),
        maxAllowedReservedProfit: (250n * ONE_CHIP).toString(),
      },
      sessions: {
        items: sessions.map(session => ({
          sessionId: session.sessionId,
          sessionKey: session.sessionKey,
          gameAddress: DEMO_GAME_ADDRESS,
          phase: session.settled ? SessionPhase.SETTLED : SessionPhase.WAITING_RANDOMNESS,
          phaseName: session.settled ? 'SETTLED' : 'WAITING_RANDOMNESS',
          wager: session.wager.toString(),
          stake: session.wager.toString(),
          payout: session.settled ? session.payout.toString() : undefined,
          isSettled: session.settled,
          openedAt: session.at,
          settledAt: session.settled ? session.at : undefined,
          lastEventTimestamp: session.at,
          raw: {
            gameData: encodeGameData(session.bet),
            gameState: session.settled
              ? encodeGameState({
                  order: session.order,
                  candle: session.bet.candle,
                  ticket: session.bet.ticket,
                  won: session.won,
                  payout: session.payout,
                })
              : undefined,
            randomness: session.word,
          },
        })),
      },
      ui: { locale: 'en', theme: 'dark' },
    }),
    [balance, sessions],
  );

  return { hostApi: { openSession, revealOutcome }, snapshot, refill, low: balance < DEMO_REFILL_BELOW };
}
