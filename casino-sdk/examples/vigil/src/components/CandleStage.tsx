import { CANDLE_COUNT, type TicketId } from '../game/constants';
import { liveMultiplierState, survivorProbabilityFloats } from '../game/live';
import { multiplierLabel } from '../game/payout';
import { ticketResolvedOn } from '../game/reveal';

export type StagePhase = 'idle' | 'burning' | 'revealing' | 'settled';

export type CandleStageProps = {
  phase: StagePhase;
  ticket: TicketId;
  /** The candle the player backed, or `null` while none is lit. */
  pick: number | null;
  /** The death order from the contract, once it is known. */
  order: readonly number[] | null;
  /** How many snuffs are on screen. */
  revealed: number;
  /** The candle whose flame is agitated by the tension beat, if any. */
  tension: number | null;
  /** The candle held in slow motion for a near-miss, if any. */
  slowMo: number | null;
  interactive: boolean;
  onPick: (candle: number) => void;
  onSkip: () => void;
};

/**
 * The vigil: six procedural candles in a dark room. Each candle's wax height and thickness encode
 * its death weight (candle 1 is the thick favourite, candle 6 the thin long shot), its flame
 * flickers on its own phase, and a snuff plays as the death order is replayed — flame gutters,
 * glow dies, a wisp of smoke rises, and every survivor's odds re-price on the bars underneath.
 */
export function CandleStage({
  phase,
  ticket,
  pick,
  order,
  revealed,
  tension,
  slowMo,
  interactive,
  onPick,
  onSkip,
}: CandleStageProps) {
  const shown = order ? order.slice(0, revealed) : [];
  const dead = new Set(shown);
  const resolveAt = ticketResolvedOn(ticket);
  const floats = survivorProbabilityFloats(ticket, shown);

  return (
    <div className="vg-stage">
      <div className="vg-board">
        {Array.from({ length: CANDLE_COUNT }, (_, candle) => {
          const isDead = dead.has(candle);
          const isPick = pick === candle;
          const isWinner = isPick && !isDead && order !== null && revealed >= resolveAt;
          const state = liveMultiplierState(ticket, shown, candle);
          const chance = floats[candle] ?? 0;
          const multiplier =
            state === null ? '—' : state.locked ? multiplierLabel(candle, ticket) : `${state.x.toFixed(2)}x`;
          const percent = `${(chance * 100).toFixed(2)}%`;

          const classes = ['vg-candle'];
          if (isPick) classes.push('is-pick');
          if (isDead) classes.push('is-out');
          if (isWinner) classes.push('is-winner');
          if (tension === candle) classes.push('is-tension');
          if (slowMo === candle) classes.push('is-slowmo');

          return (
            <button
              key={candle}
              type="button"
              className={classes.join(' ')}
              style={{ ['--vg-i' as string]: candle }}
              disabled={!interactive}
              aria-pressed={isPick}
              aria-label={
                isDead
                  ? `Candle ${candle + 1}, out`
                  : `Candle ${candle + 1}, ${percent} chance, pays ${multiplier}`
              }
              onClick={() => onPick(candle)}
            >
              <span className="vg-candle__mult">{multiplier}</span>
              <span className="vg-candle__stack">
                <span className="vg-candle__scene">
                  <span className="vg-candle__glow" aria-hidden />
                  <span className="vg-candle__smoke" aria-hidden />
                  <span className="vg-candle__flame" aria-hidden />
                </span>
                <span className="vg-candle__wick" aria-hidden />
                <span className="vg-candle__wax" aria-hidden />
              </span>
              <span className="vg-candle__chance">
                <span className="vg-candle__pct">
                  <b>{candle + 1}</b>
                  {isDead ? 'out' : percent}
                </span>
                <span className="vg-candle__bar">
                  <span style={{ width: `${Math.max(0, Math.min(1, chance)) * 100}%` }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {phase === 'idle' && (
        <div className="vg-prompt">
          {pick === null ? 'Six candles. One survivor. Pick yours.' : 'Light it up to start the vigil.'}
        </div>
      )}

      {phase === 'burning' && <div className="vg-status">The candles burn…</div>}

      {phase === 'revealing' && (
        <button type="button" className="vg-skip" onClick={onSkip}>
          Skip
        </button>
      )}

      {order && (
        <div className="vg-order" role="group" aria-label="Death order">
          <span className="vg-order__title">Order</span>
          {Array.from({ length: CANDLE_COUNT }, (_, slot) => {
            const isSurvivor = slot === CANDLE_COUNT - 1;
            // The last slot is the survivor: it is never snuffed, so it fills when the vigil ends.
            const filled = slot < revealed || (isSurvivor && revealed >= CANDLE_COUNT - 1);
            const candle = order[slot];
            const chipClass = !filled
              ? 'vg-order__chip--empty'
              : isSurvivor
                ? 'vg-order__chip--survivor'
                : candle === pick
                  ? 'vg-order__chip--pick'
                  : 'vg-order__chip--dead';
            return (
              <span key={slot} className={`vg-order__chip ${chipClass}`}>
                {filled ? candle + 1 : '·'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
