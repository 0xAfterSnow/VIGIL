import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import type { CSSProperties } from 'react';

import { SessionPhase, computeMaxWager } from '@chain/casino-sdk/guest';

import { useCasinoHost } from './useCasinoHost';
import { useDemoHost } from './demo/useDemoHost';
import { BottomBar } from './components/BottomBar';
import { CandleStage, type StagePhase } from './components/CandleStage';
import { HistoryStrip } from './components/HistoryStrip';
import { ResultOverlay } from './components/ResultOverlay';
import { Sidebar } from './components/Sidebar';
import { StatsStrip } from './components/StatsStrip';
import { decodeGameState, encodeGameData, orderId, type VigilBet } from './game/codec';
import { FINAL_THREE, LAST_LIT, type TicketId } from './game/constants';
import { isWin, maxMultiplierX, maxReservedProfit, payoutFor } from './game/payout';
import { buildTimeline, fateLabel, type Beat } from './game/reveal';
import { sampleOrder } from './game/sampler';

type Round = {
  sessionKey: string;
  bet: VigilBet;
  wager: bigint;
  status: 'opening' | 'waiting' | 'revealing' | 'done';
  sessionId?: string;
  /** The death order the contract decided, once the round has settled. */
  order?: number[];
  /** How many snuffs of that order are on screen. */
  revealed: number;
  /** The beat currently playing, for the tension / slow-motion flame states. */
  beat?: Beat;
  won?: boolean;
  payout?: bigint;
};

const TURBO_STORAGE_KEY = 'vigil.turbo';

/**
 * How the game is being hosted. `host` is the chain.wtf casino (or the local harness) driving the
 * real chain through the guest bridge; `demo` is free play — the same game, the same sampler, the
 * same paytable, with demo chips and locally drawn randomness.
 */
type GameMode = 'host' | 'demo';

/** A framed game that never completes the guest handshake is not a casino host — free play instead. */
const HOST_HANDSHAKE_TIMEOUT_MS = 4000;

/**
 * Standalone is the default: opened directly (no parent frame) VIGIL is a playable demo, which is
 * what anyone following the entry URL gets. `?demo=1` forces free play and `?demo=0` forces the
 * host bridge, for testing either side on purpose.
 */
function detectMode(): GameMode {
  if (typeof window === 'undefined') return 'demo';
  const forced = new URLSearchParams(window.location.search).get('demo');
  if (forced === '1') return 'demo';
  if (forced === '0') return 'host';
  return window.parent === window ? 'demo' : 'host';
}

function loadTurbo(): boolean {
  try {
    return window.localStorage.getItem(TURBO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function walletStatusMessage(status: string): string {
  return status === 'disconnected'
    ? 'Connect your wallet in the host app to play.'
    : status === 'setup-required'
      ? 'Finish setting up your Smart Vault in the host app to play.'
      : 'Restore your session key in the host app before betting.';
}

/** Headline amounts stay readable: 18 raw decimals on a result card is noise. */
function formatAmount(value: bigint, decimals: number): string {
  try {
    const amount = Number(formatUnits(value, decimals));
    if (!Number.isFinite(amount)) return formatUnits(value, decimals);
    return amount.toLocaleString('en', { maximumFractionDigits: amount >= 1000 ? 2 : 4 });
  } catch {
    return '0';
  }
}

export function App() {
  const host = useCasinoHost();
  const demo = useDemoHost();
  const [mode, setMode] = useState<GameMode>(detectMode);

  // The host bridge is only abandoned if it never answers: a real casino host resolves its
  // handshake immediately, and the frames that don't are someone else's embed.
  useEffect(() => {
    if (mode !== 'host' || host.hostApi) return;
    const timer = window.setTimeout(() => setMode('demo'), HOST_HANDSHAKE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [mode, host.hostApi]);

  const demoMode = mode === 'demo';
  const hostApi = demoMode ? demo.hostApi : host.hostApi;
  const snapshot = demoMode ? demo.snapshot : host.snapshot;

  const [ticket, setTicket] = useState<TicketId>(LAST_LIT);
  // No candle is lit until the player lights one: the board opens with all six burning.
  const [pick, setPick] = useState<number | null>(null);
  const [wagerInput, setWagerInput] = useState('1.00');
  const [round, setRound] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [turbo, setTurboState] = useState(loadTurbo);

  const setTurbo = useCallback((next: boolean) => {
    setTurboState(next);
    try {
      window.localStorage.setItem(TURBO_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Storage can be unavailable in sandboxed iframes.
    }
  }, []);

  const decimals = snapshot?.token.decimals ?? 18;
  const symbol = snapshot?.token.symbol ?? '';
  const tokenIconUrl = snapshot?.token.iconUrl;
  const balance = useMemo(() => {
    const raw = snapshot?.balances.smartVaultBalance;
    return raw !== undefined ? BigInt(raw) : undefined;
  }, [snapshot?.balances.smartVaultBalance]);

  const hostApiRef = useRef(hostApi);
  hostApiRef.current = hostApi;
  const turboRef = useRef(turbo);
  turboRef.current = turbo;
  const roundRef = useRef(round);
  roundRef.current = round;
  /** Live reveal timers, so SKIP can retire them. */
  const timersRef = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(id => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  // Settle the active round from snapshot pushes: once the host's session list shows our sessionKey
  // as terminal, decode the on-chain gameState (death order + verdict) and open the vigil.
  useEffect(() => {
    if (!round || round.status !== 'waiting' || !snapshot) return;
    const row = snapshot.sessions.items.find(item => item.sessionKey === round.sessionKey);
    if (!row || !(row.isSettled || terminalPhase(row.phase))) return;

    if (row.phase !== undefined && row.phase !== SessionPhase.SETTLED && !row.raw.gameState) {
      setError('The round did not settle normally. Your wager handling follows on-chain rules.');
      setRound(null);
      return;
    }

    const settled = row.raw.gameState ? decodeGameState(row.raw.gameState) : null;
    // The settled blob can lag the settled phase by one push. The client carries an exact mirror of
    // the contract's sampler and its win rule, so the vigil can still be replayed from the word
    // itself — never from a guess. The payout comes from the row, else from the same formula the
    // contract pays with.
    const word = row.raw.randomness;
    const fromWord =
      settled === null && word !== undefined && word !== '0x' && BigInt(word) !== 0n
        ? (() => {
            const sampled = sampleOrder(word);
            return { order: sampled, won: isWin(sampled, round.bet.candle, round.bet.ticket) };
          })()
        : null;
    if (!settled && !fromWord) return; // result not synced yet — wait for the next push

    const order = settled?.order ?? fromWord!.order;
    const won = settled?.won ?? fromWord!.won;
    const payout =
      row.payout !== undefined
        ? BigInt(row.payout)
        : (settled?.payout ?? payoutFor(round.wager, round.bet.candle, round.bet.ticket, won));

    setRound(current =>
      current && current.sessionKey === round.sessionKey
        ? {
            ...current,
            status: 'revealing',
            revealed: 0,
            sessionId: row.sessionId,
            order,
            won,
            payout,
          }
        : current,
    );
  }, [snapshot, round]);

  // Drive the reveal: one timer per snuff, then the outcome — the host only releases the withheld
  // payout into its balance displays after `revealOutcome`.
  const revealKey = round?.sessionKey;
  const revealStatus = round?.status;
  const revealOrder = round?.order;
  useEffect(() => {
    if (!revealKey || revealStatus !== 'revealing' || !revealOrder || !roundRef.current) return;
    const { bet, sessionId } = roundRef.current;
    const timeline = buildTimeline(revealOrder, bet.candle, bet.ticket, { turbo: turboRef.current });
    const key = revealKey;

    const timers: number[] = [];
    for (const beat of timeline.beats) {
      timers.push(
        window.setTimeout(() => {
          setRound(current =>
            current && current.sessionKey === key && current.status === 'revealing'
              ? { ...current, revealed: beat.revealed, beat }
              : current,
          );
        }, beat.landsAtMs),
      );
    }
    timers.push(
      window.setTimeout(() => {
        setRound(current =>
          current && current.sessionKey === key && current.status === 'revealing'
            ? { ...current, status: 'done' }
            : current,
        );
        if (sessionId) {
          void hostApiRef.current?.revealOutcome({ sessionId }).catch(() => {
            // Reveal is display-only on the host; settlement is already final.
          });
        }
      }, timeline.revealCompleteAtMs),
    );

    timersRef.current = timers;
    return () => {
      timers.forEach(id => window.clearTimeout(id));
      if (timersRef.current === timers) timersRef.current = [];
    };
  }, [revealKey, revealStatus, revealOrder]);

  const skipReveal = useCallback(() => {
    const current = roundRef.current;
    if (!current?.order) return;
    clearTimers();
    setRound(previous =>
      previous && previous.sessionKey === current.sessionKey
        ? { ...previous, revealed: current.order!.length - 1, status: 'done' }
        : previous,
    );
    if (current.sessionId) {
      void hostApiRef.current?.revealOutcome({ sessionId: current.sessionId }).catch(() => {});
    }
  }, [clearTimers]);

  const openRound = useCallback(
    async (bet: VigilBet, wager: bigint) => {
      if (!hostApi) return;
      setError(null);
      setResultDismissed(false);
      clearTimers();
      const pendingKey = `pending:${Date.now()}`;
      setRound({ sessionKey: pendingKey, bet, wager, status: 'opening', revealed: 0 });
      try {
        const { sessionKey } = await hostApi.openSession({
          wager: wager.toString(),
          gameData: encodeGameData(bet),
        });
        setRound(current =>
          current?.sessionKey === pendingKey
            ? { ...current, sessionKey, status: 'waiting' }
            : current,
        );
      } catch (cause) {
        setRound(null);
        setError(cause instanceof Error ? cause.message : 'Failed to open the round.');
      }
    },
    [hostApi, clearTimers],
  );

  const wager = useMemo(() => {
    if (!wagerInput.trim()) return null;
    try {
      const parsed = parseUnits(wagerInput.trim(), decimals);
      return parsed > 0n ? parsed : null;
    } catch {
      return null;
    }
  }, [wagerInput, decimals]);

  const maxAllowedReservedProfit = useMemo(() => {
    const raw = snapshot?.casino?.maxAllowedReservedProfit;
    return raw !== undefined ? BigInt(raw) : undefined;
  }, [snapshot?.casino?.maxAllowedReservedProfit]);

  // The largest bet the platform accepts for the current candle + ticket, so the UI can clamp
  // instead of letting the transaction get rejected on-chain. VIGIL's reserved profit is linear in
  // the wager, so `computeMaxWager` with the ticket's worst-case multiplier is exact.
  const platformMaxWager = useMemo(() => {
    if (pick === null) return undefined;
    const result = computeMaxWager(snapshot, { maxMultiplierX: maxMultiplierX(pick, ticket) });
    return result.kind === 'limit' ? result.maxWager : undefined;
  }, [snapshot, pick, ticket]);

  const walletReady = snapshot?.wallet.status === 'ready';
  const roundInFlight =
    round !== null &&
    (round.status === 'opening' || round.status === 'waiting' || round.status === 'revealing');
  const roundDone = round?.status === 'done';
  const needsPick = pick === null;

  const insufficientBalance = wager !== null && balance !== undefined && wager > balance;
  const exceedsRiskLimit =
    wager !== null &&
    pick !== null &&
    maxAllowedReservedProfit !== undefined &&
    maxReservedProfit(wager, pick, ticket) > maxAllowedReservedProfit;

  const canBet =
    walletReady &&
    !roundInFlight &&
    !needsPick &&
    wager !== null &&
    !insufficientBalance &&
    !exceedsRiskLimit;

  const handleBet = useCallback(() => {
    if (pick === null || wager === null) return;
    // A rematch keeps the candle and the ticket: `pick`/`ticket` are the live selection.
    void openRound({ candle: pick, ticket }, wager);
  }, [pick, ticket, wager, openRound]);

  const handlePick = useCallback((candle: number) => {
    // The candle is frozen for the duration of a vigil; only a settled board takes a new pick.
    if (roundRef.current && roundRef.current.status !== 'done') return;
    setPick(candle);
    setResultDismissed(true);
  }, []);

  // Keyboard: 1-6 light a candle, T turbo, L/F the ticket, Enter bets. PRD §4.5.
  const canBetRef = useRef(canBet);
  canBetRef.current = canBet;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      if (event.key >= '1' && event.key <= '6') {
        handlePick(Number(event.key) - 1);
        return;
      }
      if (event.key === 't' || event.key === 'T') {
        setTurbo(!turboRef.current);
        return;
      }
      if (event.key === 'l' || event.key === 'L') {
        setTicket(LAST_LIT);
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        setTicket(FINAL_THREE);
        return;
      }
      if (event.key === 'Enter' && canBetRef.current) {
        event.preventDefault();
        handleBet();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBet, handlePick, setTurbo]);

  if (!hostApi || !snapshot) {
    return (
      <div className="ck-canvas-loading">
        <div className="ck-canvas-loading__card">
          <div className="ck-canvas-loading__spinner" aria-hidden />
          <span className="ck-canvas-loading__label">Connecting to host…</span>
        </div>
      </div>
    );
  }

  const reason = !walletReady
    ? walletStatusMessage(snapshot.wallet.status)
    : error
      ? error
      : needsPick
        ? 'Light a candle on the board to back it.'
        : insufficientBalance
          ? 'Insufficient balance.'
          : exceedsRiskLimit
            ? platformMaxWager !== undefined
              ? `Potential win exceeds the current house risk limit. Max bet: ${formatUnits(platformMaxWager, decimals)} ${symbol}.`
              : 'Potential win exceeds the house risk limit.'
            : null;

  const ctaLabel = roundInFlight ? 'Burning…' : roundDone ? 'Light up again' : 'Light up';

  const stagePhase: StagePhase =
    round === null
      ? 'idle'
      : round.status === 'opening' || round.status === 'waiting'
        ? 'burning'
        : round.status === 'revealing'
          ? 'revealing'
          : 'settled';

  const order = round?.order ?? null;
  const revealed = round?.revealed ?? 0;
  const showResult = roundDone && !resultDismissed && round?.order !== undefined;

  const payout = round?.payout;
  const realizedMultiplier =
    round && payout !== undefined && round.wager > 0n
      ? Number((payout * 10000n) / round.wager) / 10000
      : 0;
  const netProfit = round && payout !== undefined && payout > round.wager ? payout - round.wager : 0n;

  const availableHeight = snapshot.ui.viewport?.availableHeight;
  const shellStyle = availableHeight
    ? ({ ['--ck-available-height' as string]: `${availableHeight}px` } as CSSProperties)
    : undefined;

  return (
    <div className="ck-shell" style={shellStyle}>
      <div className="ck-shell__main">
        <div className="ck-shell__backdrop" aria-hidden />
        <div className="ck-shell__sidebar-host">
          <Sidebar
            ticket={ticket}
            setTicket={setTicket}
            pick={pick}
            wagerInput={wagerInput}
            setWagerInput={setWagerInput}
            balance={balance}
            maxWager={platformMaxWager}
            decimals={decimals}
            symbol={symbol}
            tokenIconUrl={tokenIconUrl}
            turbo={turbo}
            setTurbo={setTurbo}
            ctaLabel={ctaLabel}
            ctaDisabled={!canBet}
            reason={reason}
            onBet={handleBet}
            locked={roundInFlight}
            demo={demoMode}
            canRefill={demoMode && demo.low}
            onRefill={demo.refill}
          />
        </div>
        <div className="ck-shell__canvas">
          <HistoryStrip
            sessions={snapshot.sessions.items}
            gameAddress={snapshot.integration.gameAddress}
            hideSessionKey={roundInFlight ? round?.sessionKey : undefined}
          />
          <CandleStage
            phase={stagePhase}
            ticket={ticket}
            pick={pick}
            order={order}
            revealed={revealed}
            tension={round?.beat?.tension ? round.beat.candle : null}
            slowMo={round?.beat?.slowMo ? round.beat.candle : null}
            interactive={!roundInFlight}
            onPick={handlePick}
            onSkip={skipReveal}
          />
          <StatsStrip
            ticket={ticket}
            pick={pick}
            order={order}
            revealed={revealed}
            wagerInput={wagerInput}
            decimals={decimals}
            symbol={symbol}
            tokenIconUrl={tokenIconUrl}
          />
          <ResultOverlay
            visible={showResult}
            won={round?.won === true}
            multText={
              round?.won === true
                ? `${realizedMultiplier.toFixed(2)}x`
                : round
                  ? `−${formatAmount(round.wager, decimals)}`
                  : ''
            }
            amountText={`+ ${formatAmount(netProfit, decimals)}`}
            orderText={round?.order ? `ORDER ${orderId(round.order)}` : ''}
            fateText={
              round?.order ? `CANDLE ${round.bet.candle + 1} · ${fateLabel(round.order, round.bet.candle)}` : ''
            }
            symbol={symbol}
            tokenIconUrl={tokenIconUrl}
            onDismiss={() => setResultDismissed(true)}
          />
        </div>
      </div>
      <BottomBar demo={demoMode} />
    </div>
  );
}

function terminalPhase(phase: number | undefined): boolean {
  return (
    phase === SessionPhase.SETTLED ||
    phase === SessionPhase.FORFEITED ||
    phase === SessionPhase.CANCELLED
  );
}
