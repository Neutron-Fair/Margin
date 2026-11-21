import type { OrderParams } from './types.ts';

/**
 * 默认参数 —— 逐项照搬原始 cs.md 的默认值
 * 默认订单 1000 本，应得：总成本 ¥3,579.96 / 单本 ¥3.5799
 */
export const DEFAULT_PARAMS: OrderParams = {
  orderQty: 1000,
  shippingFee: 0,
  inner: {
    len: 0.21,
    wid: 0.148,
    gram: 80,
    ton: 5500,
    sheets: 80,
    paperWaste: 3,
    imposition: 4,
    wasteSheets: 200,
    printSide: 'double',
    setupFee: 80,
    pricePerPrint: 0.012,
  },
  liner: {
    len: 0.21,
    wid: 0.148,
    gram: 100,
    ton: 5800,
    sheets: 1,
    paperWaste: 3,
    imposition: 4,
    wasteSheets: 100,
    printSide: 'single',
    setupFee: 60,
    pricePerPrint: 0.012,
  },
  cover: {
    len: 0.22,
    wid: 0.155,
    gram: 250,
    ton: 6800,
    sheets: 1,
    paperWaste: 2,
    imposition: 2,
    wasteSheets: 150,
    printSide: 'double',
    setupFee: 120,
    pricePerPrint: 0.015,
    laminate: true,
    foil: false,
    foilPrice: 0.1,
    uv: false,
    uvPrice: 0.09,
  },
  back: {
    len: 0.22,
    wid: 0.155,
    gram: 200,
    ton: 6200,
    sheets: 1,
    paperWaste: 2,
    imposition: 2,
    wasteSheets: 150,
    printSide: 'double',
    setupFee: 90,
    pricePerPrint: 0.012,
    laminate: true,
    foil: false,
    foilPrice: 0.08,
    uv: false,
    uvPrice: 0.07,
  },
  gray: {
    len: 0.22,
    wid: 0.155,
    gram: 600,
    ton: 4500,
    sheetsPerBook: 1,
    paperWaste: 1.5,
  },
  misc: {
    coilPrice: 0.35,
    coilsPerBook: 1,
    bindingFee: 0.28,
    packagingFee: 0.22,
    fixedOverhead: 380,
    wasteRate: 2.8,
  },
  profitTax: {
    profitRate: 0,
    taxRate: 0,
  },
};

/** 深拷贝默认参数，避免 UI 误改常量 */
export function cloneDefaultParams(): OrderParams {
  return JSON.parse(JSON.stringify(DEFAULT_PARAMS)) as OrderParams;
}

/** 覆膜计价系数：元/m² */
export const LAMINATE_RATE = 0.38;
/** 覆膜最低收费（元） */
export const LAMINATE_MIN = 60;
/** 覆膜面积损耗系数 */
export const LAMINATE_LOSS = 1.1;
