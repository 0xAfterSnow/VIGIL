import { useMemo } from 'react';
import { formatUnits } from 'viem';

import { FINAL_THREE, LAST_LIT, TICKETS, type TicketId } from '../game/constants';
import { multiplierLabel } from '../game/payout';
import { DEMO_START_CHIPS } from '../demo/useDemoHost';
import { BetAmountInput, CtaButton, TokenIcon } from './ui/controls';
import { CandlesIcon, FlameIcon, RocketIcon } from './ui/icons';
import { ToggleSwitch } from './ui/ToggleSwitch';

export type SidebarProps = {
  ticket: TicketId;
  setTicket: (ticket: TicketId) => void;
  /** The candle the player backed, or `null` while none is lit. */
  pick: number | null;
  wagerInput: string;
  setWagerInput: (value: string) => void;
  balance: bigint | undefined;
  /** Largest wager the platform accepts right now (risk limit), if known. */
  maxWager: bigint | undefined;
  decimals: number;
  symbol: string;
  tokenIconUrl?: string;
  turbo: boolean;
  setTurbo: (value: boolean) => void;
  ctaLabel: string;
  ctaDisabled: boolean;
  reason: string | null;
  onBet: () => void;
  /** True while a round is in flight: the ticket and the wager are frozen. */
  locked: boolean;
  /** Free play: demo chips, locally drawn randomness, no real money. */
  demo: boolean;
  /** Free play only: offer the refill chip when the balance runs low. */
  canRefill: boolean;
  onRefill: () => void;
};

const TICKET_ICONS: Record<number, typeof FlameIcon> = {
  [LAST_LIT]: FlameIcon,
  [FINAL_THREE]: CandlesIcon,
};

export function Sidebar({
  ticket,
  setTicket,
  pick,
  wagerInput,
  setWagerInput,
  balance,
  maxWager,
  decimals,
  symbol,
  tokenIconUrl,
  turbo,
  setTurbo,
  ctaLabel,
  ctaDisabled,
  reason,
  onBet,
  locked,
  demo,
  canRefill,
  onRefill,
}: SidebarProps) {
  const formattedBalance = useMemo(() => {
    if (balance === undefined) return null;
    try {
      return Number(formatUnits(balance, decimals)).toLocaleString('en', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return null;
    }
  }, [balance, decimals]);

  const adjustWager = (factor: number) => {
    const next = (Number(wagerInput) || 0) * factor;
    if (next > 0) setWagerInput(next.toString());
  };

  const setMaxWager = () => {
    const candidates = [balance, maxWager].filter((value): value is bigint => value !== undefined);
    if (candidates.length === 0) return;
    setWagerInput(formatUnits(candidates.reduce((a, b) => (a < b ? a : b)), decimals));
  };

  return (
    <aside className="ck-sidebar">
      <div className="vg-pick">
        {TICKETS.map(t => {
          const Icon = TICKET_ICONS[t.id] ?? FlameIcon;
          const active = ticket === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`vg-pick__pill${active ? ' vg-pick__pill--active' : ''}`}
              aria-pressed={active}
              disabled={locked}
              title={t.oneLiner}
              onClick={() => setTicket(t.id)}
            >
              <span className="vg-pick__face">
                <Icon className="vg-pick__icon" />
                <span className="vg-pick__row">
                  <span className="vg-pick__label">{t.label}</span>
                  <span className="vg-pick__odds">
                    {pick === null ? 'pick a candle' : multiplierLabel(pick, t.id)}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="ck-sidebar__scroll">
        <div className="ck-sidebar__bet-block">
          <label className="ck-sidebar__bet-label" htmlFor="vg-wager">
            Bet Amount
          </label>
          <BetAmountInput
            id="vg-wager"
            value={wagerInput}
            disabled={locked}
            onChange={e => setWagerInput(e.target.value)}
            placeholder="0.00"
            leading={<TokenIcon symbol={symbol} iconUrl={tokenIconUrl} size={23} />}
          />
          <div className="ck-sidebar__chips">
            <button type="button" className="ck-chip" disabled={locked} onClick={() => adjustWager(0.25)}>
              1/4
            </button>
            <button type="button" className="ck-chip" disabled={locked} onClick={() => adjustWager(0.5)}>
              1/2
            </button>
            <button type="button" className="ck-chip" disabled={locked} onClick={() => adjustWager(2)}>
              2x
            </button>
            <button type="button" className="ck-chip" disabled={locked} onClick={setMaxWager}>
              Max
            </button>
          </div>
        </div>
      </div>

      <div className="ck-sidebar__foot ck-sidebar__foot--fastmode">
        <div className="ck-sidebar__fastmode">
          <span className="ck-sidebar__fastmode-label">
            <RocketIcon />
            Turbo
          </span>
          <ToggleSwitch checked={turbo} onChange={setTurbo} aria-label="Turbo" />
        </div>
      </div>

      <div className="ck-sidebar__foot ck-sidebar__foot--cta">
        {formattedBalance !== null && (
          <div className="ck-sidebar__balance">
            <span className="ck-sidebar__balance-label">{demo ? 'Demo balance:' : 'Balance:'}</span>
            <span className="ck-sidebar__balance-value">
              <TokenIcon symbol={symbol} iconUrl={tokenIconUrl} size={18} />
              <span className="ck-sidebar__balance-amount">{formattedBalance}</span>
            </span>
          </div>
        )}
        {canRefill && (
          <button type="button" className="ck-chip" disabled={locked} onClick={onRefill}>
            Refill {formatUnits(DEMO_START_CHIPS, decimals)} demo chips
          </button>
        )}
        <CtaButton disabled={ctaDisabled} onClick={onBet}>
          {ctaLabel}
        </CtaButton>
        {reason && <p className="ck-sidebar__reason">{reason}</p>}
      </div>
    </aside>
  );
}
