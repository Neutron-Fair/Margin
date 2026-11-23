import type { OrderParams } from './types.ts';
import { calcOrder, laminateCost, safeQty } from './calc.ts';

export type IssueLevel = 'info' | 'warn' | 'error';

export interface Issue {
  level: IssueLevel;
  code: string;
  title: string;
  detail: string;
  /** 对应参数字段路径，便于 UI 定位（如 cover.ton） */
  field?: string;
  /** 建议动作（UI 可显示为按钮文案） */
  hint?: string;
}

const pick = (obj: unknown, path: string): number | undefined => {
  const segs = path.split('.');
  let cur: unknown = obj;
  for (const s of segs) {
    if (cur && typeof cur === 'object' && s in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[s];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'number' ? cur : undefined;
};

const numericFields: Array<[string, boolean, boolean]> = [
  ['orderQty', true, true],
  ...(['inner', 'liner', 'cover', 'back'] as const).flatMap((key): Array<[string, boolean, boolean]> =>
    ['len', 'wid', 'gram', 'ton', 'sheets', 'paperWaste', 'imposition', 'wasteSheets', 'setupFee', 'pricePerPrint'].map((field) =>
      [`${key}.${field}`, field === 'imposition', ['sheets', 'imposition', 'wasteSheets'].includes(field)])),
  ...(['cover', 'back'] as const).flatMap((key): Array<[string, boolean, boolean]> =>
    ['foilPrice', 'uvPrice'].map((field) => [`${key}.${field}`, false, false])),
  ...['len', 'wid', 'gram', 'ton', 'sheetsPerBook', 'paperWaste'].map((field): [string, boolean, boolean] =>
    [`gray.${field}`, false, field === 'sheetsPerBook']),
  ...['coilPrice', 'coilsPerBook', 'bindingFee', 'packagingFee', 'fixedOverhead', 'wasteRate'].map((field): [string, boolean, boolean] =>
    [`misc.${field}`, false, field === 'coilsPerBook']),
  ['profitTax.profitRate', false, false], ['profitTax.taxRate', false, false],
];

/** 数据安全检查：调用方必须在报价和导出前阻断这些错误。 */
export function validateSafety(params: OrderParams): Issue[] {
  const issues: Issue[] = [];
  for (const [field, positive, integer] of numericFields) {
    const value = pick(params, field);
    if (value === undefined || !Number.isFinite(value) || value < (positive ? 1 : 0) || (integer && !Number.isSafeInteger(value))) {
      issues.push({ level: 'error', code: `invalid:${field}`, field, title: '输入数据无效',
        detail: `${field} 必须是${positive ? '正' : '非负'}${integer ? '安全整数' : '有限数字'}。` });
    }
  }
  // 历史方案没有运费字段时按零处理；存在时必须是合法金额。
  if (params?.shippingFee !== undefined && (typeof params.shippingFee !== 'number' || !Number.isFinite(params.shippingFee) || params.shippingFee < 0)) {
    issues.push({ level: 'error', code: 'invalid:shippingFee', field: 'shippingFee', title: '运费无效', detail: '运费必须是非负有限数字。' });
  }
  for (const key of ['inner', 'liner', 'cover', 'back'] as const) {
    if (!['single', 'double'].includes(params?.[key]?.printSide)) {
      issues.push({ level: 'error', code: `invalid:${key}.printSide`, field: `${key}.printSide`, title: '印刷面无效', detail: '请选择单面或双面。' });
    }
  }
  for (const key of ['cover', 'back'] as const) {
    for (const field of ['laminate', 'foil', 'uv'] as const) {
      if (typeof params?.[key]?.[field] !== 'boolean') issues.push({ level: 'error', code: `invalid:${key}.${field}`, field: `${key}.${field}`, title: '工艺开关无效', detail: '工艺开关必须为布尔值。' });
    }
  }
  if (issues.length === 0) {
    const result = calcOrder(params);
    const finite = (value: unknown): boolean => typeof value === 'number' ? Number.isFinite(value) && value >= 0 :
      value !== null && typeof value === 'object' && Object.values(value).every(finite);
    if (!finite(result) || !Number.isFinite(result.finalQuote + (params.shippingFee ?? 0))) issues.push({ level: 'error', code: 'invalid:result', title: '计算结果超出范围', detail: '参数过大导致计算结果无效，请检查输入。' });
  }
  return issues;
}

/**
 * 本地规则体检：不联网；安全错误必须由调用方阻断报价及导出。
 * AI 体检是在此基础上的补充（AI 不可用时本函数仍完整可用）
 */
export function validateParams(params: OrderParams): Issue[] {
  const issues: Issue[] = validateSafety(params);
  if (issues.length) return issues;
  const qty = safeQty(params.orderQty);
  const result = calcOrder(params);

  const push = (i: Issue) => issues.push(i);

  // 1) 关键区间
  const checks: Array<[string, string, number, number, string]> = [
    ['inner.ton', '内页吨价', 3800, 9500, '元/吨'],
    ['liner.ton', '衬纸吨价', 3800, 9500, '元/吨'],
    ['cover.ton', '封面吨价', 5200, 13000, '元/吨'],
    ['back.ton', '封底吨价', 4800, 12000, '元/吨'],
    ['gray.ton', '灰板吨价', 2800, 7500, '元/吨'],
    ['inner.paperWaste', '内页纸张损耗率', 0, 8, '%'],
    ['liner.paperWaste', '衬纸纸张损耗率', 0, 8, '%'],
    ['cover.paperWaste', '封面纸张损耗率', 0, 8, '%'],
    ['back.paperWaste', '封底纸张损耗率', 0, 8, '%'],
    ['misc.wasteRate', '订单损耗率', 0, 8, '%'],
    ['cover.pricePerPrint', '封面印工单价', 0.004, 0.06, '元/印'],
    ['inner.pricePerPrint', '内页印工单价', 0.004, 0.06, '元/印'],
    ['inner.imposition', '内页拼版数', 1, 32, '面/版'],
    ['cover.imposition', '封面拼版数', 1, 16, '面/版'],
  ];

  for (const [field, label, min, max, unit] of checks) {
    const v = pick(params, field);
    if (v === undefined) continue;
    if (v < min) {
      push({
        level: v < min * 0.5 ? 'error' : 'warn',
        code: `below:${field}`,
        title: `${label}偏低`,
        detail: `当前 ${v}${unit}，常见下限约 ${min}${unit}。价格可能算得过低。`,
        field,
        hint: '检查是否漏了小数位或单位',
      });
    } else if (v > max) {
      push({
        level: v > max * 2 ? 'error' : 'warn',
        code: `above:${field}`,
        title: `${label}偏高`,
        detail: `当前 ${v}${unit}，常见上限约 ${max}${unit}。报价可能偏高丢单。`,
        field,
        hint: '确认吨价是否含税/含运费',
      });
    }
  }

  // 2) 覆膜是否被最低价兜底（影响单本价，容易被忽略）
  for (const key of ['cover', 'back'] as const) {
    const m = params[key];
    if (!m.laminate) continue;
    const lam = laminateCost(m.len, m.wid, qty);
    if (lam.hitMin) {
      push({
        level: 'info',
        code: `laminate-min:${key}`,
        title: `${key === 'cover' ? '封面' : '封底'}覆膜按最低价计`,
        detail: `按面积应为 ¥${lam.raw.toFixed(2)}，不足 ¥60，按 ¥60 计。`,
        hint: '小批量时覆膜占比会明显变高',
      });
    }
  }

  // 3) 衬纸与内页尺寸不一致（常见录错）
  const innerArea = params.inner.len * params.inner.wid;
  const linerArea = params.liner.len * params.liner.wid;
  if (linerArea > 0 && innerArea > 0) {
    const diff = Math.abs(linerArea - innerArea) / innerArea;
    if (diff > 0.05) {
      push({
        level: 'warn',
        code: 'liner-size',
        title: '衬纸尺寸与内页不一致',
        detail: `内页 ${(params.inner.len * 1000).toFixed(0)}×${(params.inner.wid * 1000).toFixed(0)}mm，衬纸 ${(params.liner.len * 1000).toFixed(0)}×${(params.liner.wid * 1000).toFixed(0)}mm，面积差 ${(diff * 100).toFixed(1)}%。`,
        field: 'liner.len',
        hint: '衬纸通常是内页同尺寸或略小 2–3mm',
      });
    }
  }

  // 4) 每本张数极值
  if (params.inner.sheets <= 0) {
    push({
      level: 'error',
      code: 'inner-sheets',
      title: '内页每本张数为 0',
      detail: '内页整块不计入报价（纸与印刷都是 0），报价会严重偏低。要算内页请填大于 0 的张数。',
      field: 'inner.sheets',
    });
  }

  // 5) 单本价格合理性
  const unit = result.unitFinalPrice;
  if (unit > 0 && unit < 0.8) {
    push({
      level: 'warn',
      code: 'unit-low',
      title: `单本价偏低（¥${unit.toFixed(2)}）`,
      detail: '线圈本含装订与包装，通常不会低于 ¥1。请检查参数是否漏项。',
    });
  }
  if (unit > 60) {
    push({
      level: 'info',
      code: 'unit-high',
      title: `单本价偏高（¥${unit.toFixed(1)}）`,
      detail: '若为特种纸/精装属正常，否则检查吨价与克重。',
    });
  }

  // 6) 固定杂费在极小批量下的失真
  if (qty < 100 && params.misc.fixedOverhead > 0) {
    push({
      level: 'info',
      code: 'fixed-small-batch',
      title: '小批量固定杂费摊薄明显',
      detail: `固定杂费 ¥${params.misc.fixedOverhead} 摊到 ${qty} 本，每本 ¥${(params.misc.fixedOverhead / qty).toFixed(2)}。`,
    });
  }

  const order: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

export const ISSUE_LABEL: Record<IssueLevel, string> = {
  error: '必须核对',
  warn: '建议核对',
  info: '提示',
};
