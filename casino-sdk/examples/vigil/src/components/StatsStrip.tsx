import { useMemo } from 'react';
import { formatUnits, parseUnits } from 'viem';

import type { TicketId } from '../game/constants';
import { liveMultiplierState, liveProbability } from '../game/live';
import { maxPayout, multiplierLabel } from '../game/payout';
import { TokenIcon } from './ui/controls';

/**
 * Bottom-of-canvas readout. "Profit on Win" is the ticket's paying price for the candle you
 * backed (locked at bet time, exactly what the contract pays). "Win Chance" is the live,
 * re-priced figure — the one that moves after every snuff.
 */
export function StatsStrip({
  ticket,
  pick,
  order,
  revealed,
  wagerInput,
  decimals,
  symbol,
  tokenIconUrl,
}: {
  ticket: TicketId;
  pick: number | null;
  order: readonly number[] | null;
  revealed: number;
  wagerInput: string;
  decimals: number;
  symbol: string;
  tokenIconUrl?: string;
}) {
  const stats = useMemo(() => {
    const shown = order ? order.slice(0, revealed) : [];
    if (pick === null) return { multiplier: '—', winChance: '—', profitOnWin: '—' };

    const winChance = (liveProbability(ticket, shown, pick) * 100).toFixed(2);
    const state = liveMultiplierState(ticket, shown, pick);
    const multiplier = multiplierLabel(pick, ticket);
    if (state === null) return { multiplier, winChance, profitOnWin: '—' };

    try {
      const wager = parseUnits(wagerInput || '0', decimals);
      if (wager === 0n) return { multiplier, winChance, profitOnWin: '0.00' };
      const payout = maxPayout(wager, pick, ticket);
      const profit = payout > wager ? payout - wager : 0n;
      const profitNumber = Number(formatUnits(profit, decimals));
      const profitOnWin =
        profitNumber >= 1000
          ? profitNumber.toLocaleString('en', { maximumFractionDigits: 2 })
          : profitNumber.toFixed(2);
      return { multiplier, winChance, profitOnWin };
    } catch {
      return { multiplier, winChance, profitOnWin: '0.00' };
    }
  }, [ticket, pick, order, revealed, wagerInput, decimals]);

  return (
    <div className="ck-canvas-stats">
      <div className="ck-canvas-stats__col">
        <div className="ck-canvas-stats__label">
          <span className="ck-canvas-stats__label-main">Profit on Win</span>
          <span className="ck-canvas-stats__label-sub">{`(${stats.multiplier})`}</span>
        </div>
        <div className="ck-canvas-stats__value" role="status" aria-label="Profit on win">
          <span className="ck-canvas-stats__value-inner">
            <span className="ck-canvas-stats__value-text">{stats.profitOnWin}</span>
            <TokenIcon symbol={symbol} iconUrl={tokenIconUrl} size={23} />
          </span>
        </div>
      </div>
      <div className="ck-canvas-stats__col">
        <div className="ck-canvas-stats__label">
          <span className="ck-canvas-stats__label-main">Win Chance</span>
        </div>
        <div className="ck-canvas-stats__value" role="status" aria-label="Win chance">
          <span className="ck-canvas-stats__value-inner">
            <span className="ck-canvas-stats__value-text">{stats.winChance}</span>
            {stats.winChance !== '—' && (
              <span className="ck-canvas-stats__value-suffix" aria-hidden>
                %
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
