import type { Issue } from '../engine/validate.ts';
import type { OrderParams, OrderResult } from '../engine/types.ts';
import { fmtMoney, fmtUnit } from './utils.ts';

interface ResultPanelProps {
  result: OrderResult;
  params: OrderParams;
  issues: Issue[];
  onExport: () => void;
  onSave: () => void;
  onTiers: () => void;
  onCheck: () => void;
}

export function ResultPanel({
  result: r,
  params,
  issues,
  onExport,
  onSave,
  onTiers,
  onCheck,
}: ResultPanelProps) {
  const rows = [
    { no: '01', name: '内页', val: r.modules.inner.orderTotal },
    { no: '02', name: '衬纸', val: r.modules.liner.orderTotal },
    { no: '03', name: '封面', val: r.modules.cover.orderTotal },
    { no: '04', name: '封底', val: r.modules.back.orderTotal },
    { no: '05', name: '灰板', val: r.modules.gray.orderTotal },
    { no: '06', name: '线圈', val: r.misc.coilTotal },
    { no: '07', name: '装订', val: r.misc.bindingTotal },
    { no: '08', name: '包装', val: r.misc.packTotal },
    { no: '09', name: '固定杂费', val: r.misc.fixed },
    { no: '10', name: '订单损耗', val: r.wasteAmount, pct: params.misc.wasteRate },
  ];

  const shipping = Number.isFinite(params.shippingFee) ? Math.max(0, params.shippingFee!) : 0;
  const payable = r.finalQuote + shipping;
  const warnCount = issues.filter((i) => i.level !== 'info').length;

  return (
    <div className="result-panel">
      <div className="result-head">
        <span className="result-kicker">结算 · Settlement</span>
        <span className="chip">
          <span className="label">批次 {params.orderQty} 本</span>
        </span>
      </div>

      <div className="result-hero">
        <span className="label">单本含利润含税价</span>
        <div className="result-amount">
          <span className="cny">¥</span>
          {fmtUnit(r.unitFinalPrice)}
          <span className="tail">/ 本</span>
        </div>
      </div>

      <div className="result-duo">
        <div>
          <span className="label">订单总成本</span>
          <div className="value num">
            <span style={{ fontSize: '0.62em', color: 'var(--ink-3)' }}>¥</span>
            {fmtMoney(r.costTotal)}
          </div>
        </div>
        <div>
          <span className="label">单本成本</span>
          <div className="value num">
            <span style={{ fontSize: '0.62em', color: 'var(--ink-3)' }}>¥</span>
            {fmtUnit(r.unitCost)}
          </div>
        </div>
      </div>

      <div className="break">
        {rows.map((row) => (
          <div className="break-row is-sub" key={row.no}>
            <span className="name">
              <span className="idx num">{row.no}</span>
              {row.name}
            </span>
            <span className="val">
              ¥{fmtMoney(row.val)}
              {row.pct !== undefined && <span className="pct">{row.pct}%</span>}
            </span>
          </div>
        ))}

        <div className="break-row is-sum">
          <span className="name">成本合计</span>
          <span className="val">¥{fmtMoney(r.costTotal)}</span>
        </div>

        <div className="break-row is-sub">
          <span className="name">
            <span className="idx num">11</span>利润
          </span>
          <span className="val">
            ¥{fmtMoney(r.profitAmount)}
            <span className="pct">{params.profitTax.profitRate}%</span>
          </span>
        </div>
        <div className="break-row is-sub">
          <span className="name">
            <span className="idx num">12</span>税额
          </span>
          <span className="val">
            ¥{fmtMoney(r.taxAmount)}
            <span className="pct">{params.profitTax.taxRate}%</span>
          </span>
        </div>
        <div className="break-row is-sum is-accent">
          <span className="name">最终报价</span>
          <span className="val">¥{fmtMoney(r.finalQuote)}</span>
        </div>
        <div className="break-row is-sub"><span className="name">运费（不计入成本、利润及税）</span><span className="val">¥{fmtMoney(shipping)}</span></div>
        <div className="break-row is-sum"><span className="name">含运应付总额</span><span className="val">¥{fmtMoney(payable)}</span></div>
        <div className="break-row is-sub"><span className="name">单本到货价</span><span className="val">¥{fmtUnit(payable / r.orderQty)}</span></div>
      </div>

      {issues.length > 0 && (
        <div className="issues">
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <span className="label">参数体检</span>
            <span className="label" style={{ color: warnCount ? 'var(--neg)' : 'var(--pos)' }}>
              {warnCount ? `${warnCount} 处建议核对` : '无明显异常'}
            </span>
          </div>
          {issues.slice(0, 4).map((i) => (
            <div className={`issue is-${i.level}`} key={i.code}>
              <span className="issue-dot" />
              <span>
                <strong>{i.title}</strong>
                <br />
                {i.detail}
              </span>
            </div>
          ))}
          {issues.length > 4 && (
            <button type="button" className="btn btn-ghost" style={{ marginTop: 4 }} onClick={onCheck}>
              查看全部 {issues.length} 条
            </button>
          )}
        </div>
      )}

      <div className="result-actions">
        <button type="button" className="btn btn-accent" onClick={onExport}>
          生成报价单
        </button>
        <button type="button" className="btn btn-solid" onClick={onSave}>
          保存为方案
        </button>
        <div className="btn-row">
          <button type="button" className="btn" style={{ flex: 1 }} onClick={onTiers}>
            成本加成分档
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={onCheck}>
            成本体检
          </button>
        </div>
      </div>
    </div>
  );
}
