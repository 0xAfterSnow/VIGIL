import { useEffect, type ReactNode } from 'react';

type Step = {
  title: string;
  body: ReactNode;
};

/**
 * The rules dialog. Opened from the bottom bar (and shown once on a player's first visit), it
 * walks the loop end to end — ticket, candle, stake, LIGHT UP, the reveal and, crucially, how to
 * start the next round with PLAY AGAIN once the candles are out. Esc or the backdrop closes it.
 */
const STEPS: readonly Step[] = [
  {
    title: 'Pick your ticket',
    body: (
      <>
        <b>LAST LIT</b> backs the last flame still burning. <b>FINAL THREE</b> only needs your
        candle to outlast three others — an easier ticket for a smaller payout.
      </>
    ),
  },
  {
    title: 'Light a candle',
    body: (
      <>
        Click any candle on the board (or press <kbd>1</kbd>–<kbd>6</kbd>). The italic number above
        it is what that candle pays, the bar under it is its live win chance. Candle 1 is the
        favourite, candle 6 the long shot.
      </>
    ),
  },
  {
    title: 'Set your stake',
    body: (
      <>
        Type a bet amount in the sidebar, or use the <b>1/4 · 1/2 · 2x · Max</b> chips to size it
        quickly.
      </>
    ),
  },
  {
    title: 'Light up',
    body: (
      <>
        Press <b>LIGHT UP</b> (or <kbd>Enter</kbd>) to open the round. Your candle, ticket and stake
        lock while the vigil burns.
      </>
    ),
  },
  {
    title: 'Watch the vigil',
    body: (
      <>
        The candles are snuffed one at a time and every survivor&apos;s odds re-price after each
        death. Press <b>SKIP</b> to jump straight to the result.
      </>
    ),
  },
  {
    title: 'Play again',
    body: (
      <>
        When the round is over the board is spent. Press <b>PLAY AGAIN</b> to relight all six
        candles — your candle, ticket and stake stay exactly as they were. Or click a different
        candle first to change your bet.
      </>
    ),
  },
];

export function HowToPlay({
  open,
  demo,
  onClose,
}: {
  open: boolean;
  /** Free play: the footer notes demo chips instead of the fairness line. */
  demo: boolean;
  onClose: () => void;
}) {
  // Esc closes the dialog, wherever focus happens to be.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="vg-help" onClick={onClose}>
      <div
        className="vg-help__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vg-help-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="vg-help__head">
          <h2 id="vg-help-title" className="vg-help__title">
            How to play
          </h2>
          <p className="vg-help__lede">
            Six candles burn in a dark room, one by one they go out. Back a candle — collect if it
            outlives your ticket.
          </p>
        </header>

        <ol className="vg-help__steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="vg-help__step">
              <span className="vg-help__num" aria-hidden>
                {index + 1}
              </span>
              <span className="vg-help__copy">
                <span className="vg-help__step-title">{step.title}</span>
                <span className="vg-help__step-body">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="vg-help__keys">
          <span className="vg-help__keys-label">Shortcuts</span>
          <span className="vg-help__key">
            <kbd>1</kbd>–<kbd>6</kbd> light a candle
          </span>
          <span className="vg-help__key">
            <kbd>L</kbd> / <kbd>F</kbd> ticket
          </span>
          <span className="vg-help__key">
            <kbd>Enter</kbd> light up
          </span>
          <span className="vg-help__key">
            <kbd>Esc</kbd> close
          </span>
        </div>

        <footer className="vg-help__foot">
          <span className="vg-help__rtp">
            {demo ? 'Free play · demo chips' : 'Provably fair · 96% RTP'}
          </span>
          <button type="button" className="vg-help__close" onClick={onClose}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
