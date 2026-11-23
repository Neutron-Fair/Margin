import type {
  GrayParams,
  ModuleResult,
  OrderParams,
  OrderResult,
  PaperModuleParams,
  ProcessParams,
} from './types.ts';
import { LAMINATE_LOSS, LAMINATE_MIN, LAMINATE_RATE } from './defaults.ts';

const num = (v: number, fallback = 0): number =>
  Number.isFinite(v) && !Number.isNaN(v) ? v : fallback;

/** 订单数量下限保护 */
export const safeQty = (qty: number): number => {
  const q = num(qty, 0);
  return q < 1 ? 1 : q;
};

/**
 * 单张纸价：长(m) × 宽(m) × 克重(g/m²) × 吨价(元/吨) ÷ 1,000,000
 * 例：0.21 × 0.148 × 80 × 5500 / 1e6 = 0.0136752 元/张
 */
export function sheetCost(len: number, wid: number, gram: number, ton: number): number {
  return (num(len) * num(wid) * num(gram) * num(ton)) / 1_000_000;
}

interface PaperPrintResult {
  paperPerBook: number;
  printPerBook: number;
  paperWithWaste: number;
  finalSheets: number;
  impressions: number;
  printCost: number;
  sheetCost: number;
}

/** 纸张 + 印刷 的公共计算（内页 / 衬纸 / 封面 / 封底 共用） */
function calcPaperPrint(p: PaperModuleParams, orderQty: number): PaperPrintResult {
  const sheets = num(p.sheets, 0);
  const wasteRate = num(p.paperWaste, 0) / 100;
  const sc = sheetCost(p.len, p.wid, p.gram, p.ton);

  const paperPerBookRaw = sc * sheets;
  const paperWithWaste = paperPerBookRaw * (1 + wasteRate);

  const imposition = Math.max(1, num(p.imposition, 1));
  const wasteSheets = num(p.wasteSheets, 0);
  const totalSheetsNeeded = orderQty * sheets;
  const rawSheetsTotal = Math.ceil(totalSheetsNeeded / imposition);
  const finalSheets = rawSheetsTotal + wasteSheets;
  const impressions = p.printSide === 'double' ? finalSheets * 2 : finalSheets;
  const printCost = num(p.setupFee, 0) + impressions * num(p.pricePerPrint, 0);
  const printPerBook = printCost / orderQty;

  return {
    paperPerBook: paperWithWaste,
    printPerBook,
    paperWithWaste,
    finalSheets,
    impressions,
    printCost,
    sheetCost: sc,
  };
}

/** 覆膜总价：长×宽×0.38×订单数×1.1，不足 60 元按 60 元 */
export function laminateCost(
  len: number,
  wid: number,
  orderQty: number,
): { raw: number; cost: number; hitMin: boolean } {
  const raw = num(len) * num(wid) * LAMINATE_RATE * orderQty * LAMINATE_LOSS;
  const cost = Math.max(raw, LAMINATE_MIN);
  return { raw, cost, hitMin: cost > raw };
}

/** 烫金 / UV 总价：(订单数 ÷ 拼版数) × 单价 */
export function handCost(orderQty: number, imposition: number, unitPrice: number): number {
  const imp = Math.max(1, num(imposition, 1));
  return (orderQty / imp) * num(unitPrice, 0);
}

function emptyProcessDetail(): Pick<
  ModuleResult['detail'],
  'laminate' | 'foil' | 'uv' | 'baseSheets'
> {
  return { laminate: 0, foil: 0, uv: 0, baseSheets: 0 };
}

/**
 * 「每本张数为 0」= 这个部件不存在（比如不要衬纸），整块不计。
 *
 * 2026-11-23 修正：以前只把「纸张」按 0 算，上机费与备损印张照旧计入
 * （衬纸清零后每本仍收 ¥0.0612、内页清零后仍收 ¥0.0848），用户看到的是
 * 「我已经删掉了，报价还是有这笔钱」。张数为 0 时纸、印刷、后工艺应当全为 0。
 */
function emptyModuleResult(orderQty: number, sheetCostValue = 0): ModuleResult {
  return {
    paperPerBook: 0,
    printPerBook: 0,
    processPerBook: 0,
    perBook: 0,
    orderTotal: 0,
    detail: {
      sheetCost: sheetCostValue,
      paperWithWaste: 0,
      finalSheets: 0,
      impressions: 0,
      printCost: 0,
      ...emptyProcessDetail(),
    },
  };
}

/** 该纸模块是否参与计价（每本张数 > 0） */
function hasSheets(sheets: number): boolean {
  return num(sheets, 0) > 0;
}

function buildModuleResult(
  base: PaperPrintResult,
  orderQty: number,
  process: { total: number; detail: ReturnType<typeof emptyProcessDetail> },
): ModuleResult {
  const processPerBook = process.total / orderQty;
  const perBook = base.paperPerBook + base.printPerBook + processPerBook;
  return {
    paperPerBook: base.paperPerBook,
    printPerBook: base.printPerBook,
    processPerBook,
    perBook,
    orderTotal: perBook * orderQty,
    detail: {
      sheetCost: base.sheetCost,
      paperWithWaste: base.paperWithWaste,
      finalSheets: base.finalSheets,
      impressions: base.impressions,
      printCost: base.printCost,
      ...process.detail,
    },
  };
}

/** 内页 / 衬纸：只算纸张 + 印刷；张数为 0 表示不要这个部件 */
export function calcPlainModule(p: PaperModuleParams, orderQty: number): ModuleResult {
  const qty = safeQty(orderQty);
  if (!hasSheets(p.sheets)) return emptyModuleResult(qty, sheetCost(p.len, p.wid, p.gram, p.ton));
  const base = calcPaperPrint(p, qty);
  return buildModuleResult(base, qty, { total: 0, detail: emptyProcessDetail() });
}

/** 封面 / 封底：纸张 + 印刷 + 覆膜/烫金/UV；张数为 0 时整块（含后工艺）不计 */
export function calcProcessModule(
  p: PaperModuleParams & ProcessParams,
  orderQty: number,
): ModuleResult {
  const qty = safeQty(orderQty);
  if (!hasSheets(p.sheets)) return emptyModuleResult(qty, sheetCost(p.len, p.wid, p.gram, p.ton));
  const base = calcPaperPrint(p, qty);
  const detail = emptyProcessDetail();
  const imposition = Math.max(1, num(p.imposition, 1));

  if (p.laminate) {
    detail.laminate = laminateCost(p.len, p.wid, qty).cost;
  }
  if (p.foil) {
    detail.foil = handCost(qty, imposition, p.foilPrice);
  }
  if (p.uv) {
    detail.uv = handCost(qty, imposition, p.uvPrice);
  }
  detail.baseSheets = qty / imposition;

  const total = detail.laminate + detail.foil + detail.uv;
  return buildModuleResult(base, qty, { total, detail });
}

/** 灰板：只有纸张 */
export function calcGrayModule(p: GrayParams, orderQty: number): ModuleResult {
  const qty = safeQty(orderQty);
  const wasteRate = num(p.paperWaste, 0) / 100;
  const sc = sheetCost(p.len, p.wid, p.gram, p.ton);
  const perBook = sc * num(p.sheetsPerBook, 0) * (1 + wasteRate);
  return {
    paperPerBook: perBook,
    printPerBook: 0,
    processPerBook: 0,
    perBook,
    orderTotal: perBook * qty,
    detail: {
      sheetCost: sc,
      paperWithWaste: perBook,
      finalSheets: 0,
      impressions: 0,
      printCost: 0,
      ...emptyProcessDetail(),
    },
  };
}

/**
 * 全订单汇总
 * 顺序：四模块 + 线圈 + 装订 + 包装 → 每本可变成本
 *      → + 固定杂费/订单数 → ×订单数 = baseTotal
 *      → ×(1+订单损耗%) = 成本
 *      → 利润 = 成本×利润率，税 = 成本×税率（均以成本为基数）
 */
export function calcOrder(params: OrderParams): OrderResult {
  const qty = safeQty(params.orderQty);

  const inner = calcPlainModule(params.inner, qty);
  const liner = calcPlainModule(params.liner, qty);
  const cover = calcProcessModule(params.cover, qty);
  const back = calcProcessModule(params.back, qty);
  const gray = calcGrayModule(params.gray, qty);

  const coilTotal = num(params.misc.coilPrice) * num(params.misc.coilsPerBook) * qty;
  const bindingTotal = num(params.misc.bindingFee) * qty;
  const packTotal = num(params.misc.packagingFee) * qty;
  const fixed = num(params.misc.fixedOverhead);

  const varPerBook =
    inner.perBook +
    liner.perBook +
    cover.perBook +
    back.perBook +
    gray.perBook +
    num(params.misc.coilPrice) * num(params.misc.coilsPerBook) +
    num(params.misc.bindingFee) +
    num(params.misc.packagingFee);

  const overheadPerBook = fixed / qty;
  const baseTotal = (varPerBook + overheadPerBook) * qty;
  const wasteAmount = (baseTotal * num(params.misc.wasteRate)) / 100;
  const costTotal = baseTotal + wasteAmount;

  const profitAmount = (costTotal * num(params.profitTax.profitRate)) / 100;
  const taxAmount = (costTotal * num(params.profitTax.taxRate)) / 100;
  const finalQuote = costTotal + profitAmount + taxAmount;

  return {
    orderQty: qty,
    modules: { inner, liner, cover, back, gray },
    misc: { coilTotal, bindingTotal, packTotal, fixed },
    varPerBook,
    overheadPerBook,
    baseTotal,
    wasteAmount,
    costTotal,
    unitCost: costTotal / qty,
    profitAmount,
    taxAmount,
    finalQuote,
    unitFinalPrice: finalQuote / qty,
  };
}

/** 毛利分档：按给定利润率产出多档报价 */
export function profitTiers(
  params: OrderParams,
  rates: number[] = [5, 10, 15],
): Array<{ rate: number; profitAmount: number; finalQuote: number; unitFinalPrice: number }> {
  const qty = safeQty(params.orderQty);
  const base = calcOrder({ ...params, profitTax: { ...params.profitTax, profitRate: 0 } });
  const cost = base.costTotal;
  const taxAmount = base.taxAmount;
  return rates.map((rate) => {
    const profitAmount = (cost * rate) / 100;
    const finalQuote = cost + profitAmount + taxAmount;
    return {
      rate,
      profitAmount,
      finalQuote,
      unitFinalPrice: finalQuote / qty,
    };
  });
}
