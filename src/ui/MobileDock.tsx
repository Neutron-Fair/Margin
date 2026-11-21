import type { ReactNode } from 'react';
import type { OrderResult } from '../engine/types.ts';
import { fmtMoney, fmtUnit } from './utils.ts';

export type MobileTab = 'calc' | 'detail' | 'quote' | 'more';

interface MobileDockProps {
  result: OrderResult;
  active: MobileTab;
  onGoCalc: () => void;
  onOpenResult: () => void;
  onExport: () => void;
  onOpenTools: () => void;
}

const ICONS: Record<MobileTab, ReactNode> = {
  calc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M4 7h9M4 12h16M4 17h6" />
      <circle cx="17" cy="7" r="2.2" />
      <circle cx="13" cy="17" r="2.2" />
    </svg>
  ),
  detail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M5 19V10M10 19V5M15 19v-6M20 19v-8" />
    </svg>
  ),
  quote: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M7 3.8h7l3.6 3.6V20H7z" />
      <path d="M14 3.8V7.4h3.6" />
      <path d="M9.8 12.6h5M9.8 15.6h3.4" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="8" r="1.7" />
      <circle cx="16" cy="8" r="1.7" />
      <circle cx="8" cy="16" r="1.7" />
      <circle cx="16" cy="16" r="1.7" />
    </svg>
  ),
};

/**
 * 手机端常驻价格条 + 底部导航。
 * 价格条常驻的意义：改任何一个参数都能立刻看到单本含税价，不需要跳到结果页。
 */
export function MobileDock({ result: r, active, onGoCalc, onOpenResult, onExport, onOpenTools }: MobileDockProps) {
  const tabs: Array<{ key: MobileTab; label: string; onClick: () => void }> = [
    { key: 'calc', label: '算价', onClick: onGoCalc },
    { key: 'detail', label: '明细', onClick: onOpenResult },
    { key: 'quote', label: '报价单', onClick: onExport },
    { key: 'more', label: '更多', onClick: onOpenTools },
  ];

  return (
    <div className="mobile-dock">
      <div className="dock-main">
        <div className="dock-unit">
          <span className="label">单本含税</span>
          <div className="amount num">
            <span className="cny">¥</span>
            {fmtUnit(r.unitFinalPrice)}
          </div>
        </div>
        <div className="dock-total">
          <span className="label">总报价</span>
          <div className="value num">¥{fmtMoney(r.finalQuote)}</div>
        </div>
      </div>
      <nav className="dock-tabs" aria-label="主导航">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`dock-tab${active === t.key ? ' is-active' : ''}`}
            aria-current={active === t.key ? 'page' : undefined}
            onClick={t.onClick}
          >
            {ICONS[t.key]}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
