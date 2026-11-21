import type { Issue } from '../../engine/validate.ts';
import type { OrderParams, OrderResult } from '../../engine/types.ts';
import { fmtMoney, fmtUnit } from '../utils.ts';

interface Props {
  result: OrderResult;
  params: OrderParams;
  issues: Issue[];
  onClose: () => void;
}

export function ResultDetailPanel({ result: r, params, issues, onClose }: Props) {
  const shipping = Number.isFinite(params.shippingFee) ? Math.max(0, params.shippingFee!) : 0;
  const payable = r.finalQuote + shipping;
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
    { no: '10', name: '订单损耗', val: r.wasteAmount },
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="结果明细">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">DETAIL</span>
            成本明细
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', marginBottom: 16 }}>
            <div>
              <span className="label">单本含税价</span>
              <div className="result-amount result-amount-sm">
                <span className="cny">¥</span>
                {fmtUnit(r.unitFinalPrice)}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <span className="label">订单总成本</span>
              <div className="num" style={{ fontSize: 18 }}>
                ¥{fmtMoney(r.costTotal)}
              </div>
            </div>
          </div>

          <hr className="hair-strong" />

          <div className="break" style={{ paddingTop: 10 }}>
            {rows.map((row) => (
              <div className="break-row is-sub" key={row.no}>
                <span className="name">
                  <span className="idx num">{row.no}</span>
                  {row.name}
                </span>
                <span className="val">¥{fmtMoney(row.val)}</span>
              </div>
            ))}
            <div className="break-row is-sum">
              <span className="name">成本合计</span>
              <span className="val">¥{fmtMoney(r.costTotal)}</span>
            </div>
            <div className="break-row is-sub">
              <span className="name">
                <span className="idx num">11</span>利润（{params.profitTax.profitRate}%）
              </span>
              <span className="val">¥{fmtMoney(r.profitAmount)}</span>
            </div>
            <div className="break-row is-sub">
              <span className="name">
                <span className="idx num">12</span>税额（{params.profitTax.taxRate}%）
              </span>
              <span className="val">¥{fmtMoney(r.taxAmount)}</span>
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
            <div className="issues" style={{ marginTop: 18 }}>
              <div className="label" style={{ marginBottom: 6 }}>
                参数体检 · {issues.length} 条
              </div>
              {issues.map((i) => (
                <div className={`issue is-${i.level}`} key={i.code}>
                  <span className="issue-dot" />
                  <span>
                    <strong>{i.title}</strong>
                    <br />
                    {i.detail}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
