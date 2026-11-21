import { useState } from 'react';
import type { OrderParams } from '../../engine/types.ts';
import { calcOrder, profitTiers, safeQty } from '../../engine/calc.ts';
import { fmtMoney, fmtUnit } from '../utils.ts';

interface Props {
  params: OrderParams;
  onClose: () => void;
}

const ALL_RATES = [5, 8, 10, 12, 15, 20];

export function TiersPanel({ params, onClose }: Props) {
  const [rates, setRates] = useState<number[]>([5, 10, 15]);
  const qty = safeQty(params.orderQty);
  const tiers = profitTiers(params, rates);

  // 成本基数（利润以它为基数，不含利润本身）
  const cost = calcOrder({ ...params, profitTax: { ...params.profitTax, profitRate: 0 } }).costTotal;

  const toggle = (r: number) => {
    setRates((prev) => {
      const next = prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r];
      return next.sort((a, b) => a - b);
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="成本加成分档">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">TIERS</span>
            成本加成分档
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <div className="note" style={{ paddingTop: 0, paddingBottom: 10 }}>
            <span className="note-mark" />
            <span>
              按 {qty} 本、成本基数 ¥{fmtMoney(cost)} 逐档测算（成本加成率以成本为基数上浮，非售价倒扣）。
            </span>
          </div>

          <div className="break">
            {tiers.length === 0 && <div className="empty">至少选一个成本加成率档位</div>}
            {tiers.map((t) => (
              <div className="break-row is-sub" key={t.rate} style={{ padding: '11px 0' }}>
                <span className="name">
                  <span className="idx num">{t.rate}%</span>
                  成本加成率
                  <span className="pct" style={{ marginLeft: 10 }}>
                    利润 ¥{fmtMoney(t.profitAmount)}
                  </span>
                </span>
                <span className="val">
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', marginRight: 8 }}>
                    单本 ¥{fmtUnit(t.unitFinalPrice)}
                  </span>
                  ¥{fmtMoney(t.finalQuote)}
                </span>
              </div>
            ))}
            {tiers.length > 0 && (
              <div className="break-row is-sum is-accent">
                <span className="name">报价区间</span>
                <span className="val">
                  ¥{fmtMoney(tiers[0].finalQuote)} – ¥{fmtMoney(tiers[tiers.length - 1].finalQuote)}
                </span>
              </div>
            )}
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            {ALL_RATES.map((r) => {
              const on = rates.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  className={`btn ${on ? 'btn-solid' : 'btn-ghost'}`}
                  onClick={() => toggle(r)}
                  aria-pressed={on}
                  style={{ minWidth: 52, minHeight: 30, padding: '4px 10px' }}
                >
                  {r}%
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
