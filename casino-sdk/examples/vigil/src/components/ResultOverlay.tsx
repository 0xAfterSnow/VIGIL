import { useEffect } from 'react';

import { TokenIcon } from './ui/controls';

/**
 * The settled-card recipe: the green italic Win headline with the realized multiplier tucked
 * under-right, the net payout row and the faded ORDER ID — and its red twin for a lost ticket.
 * Click anywhere dismisses; the overlay itself never blocks the canvas.
 */
export function ResultOverlay({
  visible,
  won,
  multText,
  amountText,
  orderText,
  fateText,
  symbol,
  tokenIconUrl,
  onDismiss,
}: {
  visible: boolean;
  won: boolean;
  /** `1.82x` on a win, `−1.00` (the stake) on a loss. */
  multText: string;
  /** `+ 0.82` on a win. Unused on a loss, where the ORDER ID takes the row. */
  amountText: string;
  orderText: string;
  fateText: string;
  symbol: string;
  tokenIconUrl?: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!visible) return;
    window.addEventListener('click', onDismiss);
    return () => window.removeEventListener('click', onDismiss);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div className="ck-win-overlay" role="status" aria-live="polite">
      <div className={`ck-win-overlay__card${won ? '' : ' ck-win-overlay__card--loss'}`}>
        <div className="ck-win-overlay__info">
          <div className="ck-win-overlay__headline">
            <span className="ck-win-overlay__win">{won ? 'Win' : 'Out'}</span>
            <span className="ck-win-overlay__mult">{multText}</span>
          </div>
          <div className="ck-win-overlay__payout">
            <span className={`ck-win-overlay__amount${won ? '' : ' ck-win-overlay__amount--loss'}`}>
              {won ? amountText : orderText}
            </span>
            {won && <TokenIcon symbol={symbol} iconUrl={tokenIconUrl} size={23} />}
          </div>
          <span className="ck-win-overlay__label">{won ? `${orderText} · ${fateText}` : fateText}</span>
        </div>
      </div>
    </div>
  );
}
