import { useMemo } from 'react';
import { SessionPhase, type HostSnapshotV1 } from '@chain/casino-sdk/guest';

const MAX_PILLS = 7;

type SessionRow = HostSnapshotV1['sessions']['items'][number];

function isTerminal(phase: number | undefined): boolean {
  return (
    phase === SessionPhase.SETTLED ||
    phase === SessionPhase.FORFEITED ||
    phase === SessionPhase.CANCELLED
  );
}

/**
 * Top-of-canvas history rail: the player's most recent settled vigils as multiplier pills, newest on
 * the right. Win pills get the bright green fill. The active round is withheld (`hideSessionKey`)
 * until its reveal completes, so the rail never spoils the outcome.
 */
export function HistoryStrip({
  sessions,
  gameAddress,
  hideSessionKey,
}: {
  sessions: SessionRow[];
  gameAddress?: string;
  hideSessionKey?: string;
}) {
  const recent = useMemo(() => {
    return sessions
      .filter(s => {
        if (!(s.isSettled || isTerminal(s.phase))) return false;
        if (gameAddress && s.gameAddress.toLowerCase() !== gameAddress.toLowerCase()) return false;
        if (hideSessionKey && s.sessionKey === hideSessionKey) return false;
        return true;
      })
      .sort((a, b) => a.lastEventTimestamp - b.lastEventTimestamp)
      .slice(-MAX_PILLS)
      .map(s => {
        let mult = '0.00x';
        let won = false;
        try {
          const wager = BigInt(s.wager ?? '0');
          const payout = BigInt(s.payout ?? '0');
          if (wager > 0n) mult = `${(Number((payout * 10000n) / wager) / 10000).toFixed(2)}x`;
          won = payout > wager;
        } catch {
          // leave the 0.00x fallback
        }
        return { sessionKey: s.sessionKey, mult, won };
      });
  }, [sessions, gameAddress, hideSessionKey]);

  return (
    <div className="ck-canvas-history" role="group" aria-label="Recent vigils">
      {recent.map(r => (
        <span
          key={r.sessionKey}
          className={`ck-canvas-history__pill${r.won ? ' ck-canvas-history__pill--win' : ''}`}
        >
          {r.mult}
        </span>
      ))}
    </div>
  );
}
