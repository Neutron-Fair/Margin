/**
 * 计算引擎类型定义
 * 所有长度单位 m；克重 g/m²；金额 元
 * 公式口径严格对齐原始 cs.md（利润与税以「订单总成本」为基数上浮）
 */

export type PrintSide = 'single' | 'double';

/** 纸张 + 印刷 模块参数（内页 / 衬纸 / 封面 / 封底 共用结构） */
export interface PaperModuleParams {
  /** 长 m */
  len: number;
  /** 宽 m */
  wid: number;
  /** 克重 g/m² */
  gram: number;
  /** 吨价 元/吨 */
  ton: number;
  /** 每本张数 */
  sheets: number;
  /** 纸张损耗率 % */
  paperWaste: number;
  /** 拼版数（面/版） */
  imposition: number;
  /** 备损张数 */
  wasteSheets: number;
  /** 单面 / 双面 */
  printSide: PrintSide;
  /** 上机费 元 */
  setupFee: number;
  /** 印工单价 元/印 */
  pricePerPrint: number;
}

/** 后工艺参数（仅封面 / 封底） */
export interface ProcessParams {
  laminate: boolean;
  foil: boolean;
  foilPrice: number;
  uv: boolean;
  uvPrice: number;
}

/** 灰板参数 */
export interface GrayParams {
  len: number;
  wid: number;
  gram: number;
  ton: number;
  /** 每本块数 */
  sheetsPerBook: number;
  /** 纸张损耗率 % */
  paperWaste: number;
}

/** 线圈 / 装订 / 包装 / 固定杂费 */
export interface MiscParams {
  /** 线圈单价 元/个 */
  coilPrice: number;
  /** 每本线圈数 */
  coilsPerBook: number;
  /** 装订加工费 元/本 */
  bindingFee: number;
  /** 包装费 元/本 */
  packagingFee: number;
  /** 固定杂费（模具等）元 */
  fixedOverhead: number;
  /** 订单损耗率 % */
  wasteRate: number;
}

/** 利润与税 */
export interface ProfitTaxParams {
  /** 利润率 % */
  profitRate: number;
  /** 税率 % */
  taxRate: number;
}

/** 整套订单参数 */
export interface OrderParams {
  orderQty: number;
  /** 用户确认的订单运费，独立于成本、利润和税额 */
  shippingFee?: number;
  inner: PaperModuleParams;
  /** 衬纸：算法与内页完全一致 */
  liner: PaperModuleParams;
  cover: PaperModuleParams & ProcessParams;
  back: PaperModuleParams & ProcessParams;
  gray: GrayParams;
  misc: MiscParams;
  profitTax: ProfitTaxParams;
}

/** 单个模块的计算结果与分解 */
export interface ModuleResult {
  /** 每本纸张成本 */
  paperPerBook: number;
  /** 每本印刷成本 */
  printPerBook: number;
  /** 每本后工艺成本 */
  processPerBook: number;
  /** 每本合计 */
  perBook: number;
  /** 模块总价（perBook × 订单数） */
  orderTotal: number;
  detail: {
    /** 单张纸价 */
    sheetCost: number;
    /** 含纸张损耗的每本纸成本 */
    paperWithWaste: number;
    /** 拼版后总印张（含备损） */
    finalSheets: number;
    /** 总印次 */
    impressions: number;
    /** 印刷总费用 */
    printCost: number;
    /** 覆膜总价 */
    laminate: number;
    /** 烫金总价 */
    foil: number;
    /** UV 总价 */
    uv: number;
    /** 每手本数（订单数 ÷ 拼版数） */
    baseSheets: number;
  };
}

/** 完整订单结果 */
export interface OrderResult {
  orderQty: number;
  modules: {
    inner: ModuleResult;
    liner: ModuleResult;
    cover: ModuleResult;
    back: ModuleResult;
    gray: ModuleResult;
  };
  misc: {
    coilTotal: number;
    bindingTotal: number;
    packTotal: number;
    fixed: number;
  };
  /** 不含固定杂费、不含订单损耗的每本可变成本 */
  varPerBook: number;
  /** 固定杂费摊到每本 */
  overheadPerBook: number;
  /** 加固定杂费后的订单成本（未含订单损耗） */
  baseTotal: number;
  /** 订单损耗附加金额 */
  wasteAmount: number;
  /** 订单总成本（含损耗） */
  costTotal: number;
  /** 单本综合成本（未含利润税） */
  unitCost: number;
  profitAmount: number;
  taxAmount: number;
  /** 最终报价（含利润与税） */
  finalQuote: number;
  /** 单本含利润含税价 */
  unitFinalPrice: number;
}
