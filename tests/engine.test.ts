import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcOrder,
  calcProcessModule,
  handCost,
  laminateCost,
  profitTiers,
  sheetCost,
} from '../src/engine/calc.ts';
import { cloneDefaultParams, DEFAULT_PARAMS } from '../src/engine/defaults.ts';
import { validateParams } from '../src/engine/validate.ts';

const close = (a: number, b: number, eps = 1e-6, label = '') =>
  assert.ok(
    Math.abs(a - b) <= eps,
    `${label} 期望 ${b}，实际 ${a}，差 ${(a - b).toExponential(3)}`,
  );

test('纸张张价：长×宽×克重×吨价÷1e6', () => {
  // 原始 cs.md：0.21 × 0.148 × 80 × 5500 / 1e6
  close(sheetCost(0.21, 0.148, 80, 5500), 0.0136752, 1e-10, '内页张价');
  close(sheetCost(0.22, 0.155, 250, 6800), 0.05797, 1e-10, '封面张价');
  close(sheetCost(0.22, 0.155, 600, 4500), 0.09207, 1e-10, '灰板张价');
});

test('覆膜：面积×0.38×1.1，不足 60 按 60', () => {
  const lam = laminateCost(0.22, 0.155, 1000);
  close(lam.raw, 14.2538, 1e-9, '覆膜原价');
  close(lam.cost, 60, 1e-9, '覆膜最低价');
  assert.equal(lam.hitMin, true);

  // 大批量时不再触底
  const big = laminateCost(0.22, 0.155, 100000);
  close(big.cost, 1425.38, 1e-6, '十万本覆膜');
  assert.equal(big.hitMin, false);
});

test('烫金/UV：(订单数÷拼版数)×单价', () => {
  close(handCost(1000, 2, 0.1), 50, 1e-9, '封面烫金');
  close(handCost(1000, 4, 0.09), 22.5, 1e-9, '内页拼版 UV');
});

test('关闭衬纸后与原始 cs.md 完全一致：总成本 ¥3579.96 / 单本 ¥3.5799', () => {
  const p = cloneDefaultParams();
  p.liner.sheets = 0;
  p.liner.setupFee = 0;
  p.liner.pricePerPrint = 0;
  const r = calcOrder(p);

  close(r.modules.inner.perBook, 1.69163648, 1e-8, '内页每本');
  close(r.modules.cover.perBook, 0.2586294, 1e-8, '封面每本');
  close(r.modules.back.perBook, 0.20872968, 1e-8, '封底每本');
  close(r.modules.gray.perBook, 0.09345105, 1e-8, '灰板每本');
  close(r.varPerBook, 3.10244661, 1e-8, '每本可变成本');
  close(r.baseTotal, 3482.44661, 1e-5, '加杂费后总额');
  close(r.wasteAmount, 97.50851, 1e-5, '订单损耗');
  close(r.costTotal, 3579.95512, 1e-5, '总成本');
  close(r.unitCost, 3.57995512, 1e-8, '单本成本');
  assert.equal(r.costTotal.toFixed(2), '3579.96');
  assert.equal(r.unitCost.toFixed(4), '3.5800');
  assert.equal(r.unitFinalPrice.toFixed(4), '3.5800');
});

test('默认参数（含 1 张衬纸）：衬纸正确计入总成本', () => {
  const r = calcOrder(DEFAULT_PARAMS);

  // 衬纸：张价 0.0180264 ×1×1.03 = 0.018567192，印刷 (60+350×0.012)/1000 = 0.0642
  close(r.modules.liner.perBook, 0.082767192, 1e-8, '衬纸每本');
  close(r.varPerBook, 3.185213802, 1e-8, '每本可变成本（含衬纸）');
  close(r.costTotal, 3665.03978846, 1e-4, '总成本（含衬纸）');
  close(r.unitFinalPrice, 3.66503978846, 1e-8, '单本（含衬纸）');
  assert.equal(r.costTotal.toFixed(2), '3665.04');
  assert.equal(r.unitFinalPrice.toFixed(4), '3.6650');
});

test('印张与印次：含备损张数、双面×2', () => {
  const r = calcOrder(DEFAULT_PARAMS);
  // 内页 1000×80÷4=20000 +备损200 = 20200，双面 → 40400 印次
  assert.equal(r.modules.inner.detail.finalSheets, 20200);
  assert.equal(r.modules.inner.detail.impressions, 40400);
  close(r.modules.inner.detail.printCost, 80 + 40400 * 0.012, 1e-9, '内页印刷费');

  // 封面 1000×1÷2=500 +150 = 650，双面 → 1300
  assert.equal(r.modules.cover.detail.finalSheets, 650);
  assert.equal(r.modules.cover.detail.impressions, 1300);
  close(r.modules.cover.detail.printCost, 120 + 1300 * 0.015, 1e-9, '封面印刷费');
});

test('利润与税均以成本为基数（不是售价倒扣）', () => {
  const p = cloneDefaultParams();
  p.profitTax.profitRate = 10;
  p.profitTax.taxRate = 13;
  const r = calcOrder(p);
  close(r.profitAmount, r.costTotal * 0.1, 1e-9, '利润');
  close(r.taxAmount, r.costTotal * 0.13, 1e-9, '税');
  close(r.finalQuote, r.costTotal * 1.23, 1e-9, '含利润税报价');
  close(r.unitFinalPrice, (r.costTotal * 1.23) / 1000, 1e-9, '单本含税价');
});

test('订单数量影响：纸价按本不变，印刷费与杂费按本摊薄', () => {
  const small = cloneDefaultParams();
  small.orderQty = 100;
  const big = cloneDefaultParams();
  big.orderQty = 5000;

  const rs = calcOrder(small);
  const rb = calcOrder(big);

  // 单本纸成本与订单量无关
  close(rs.modules.inner.paperPerBook, rb.modules.inner.paperPerBook, 1e-9, '纸成本不随批量变');
  // 批量越大单本越便宜（印刷上机费与固定杂费被摊薄）
  assert.ok(rb.unitFinalPrice < rs.unitFinalPrice, '大批量单本应更便宜');
});

test('衬纸默认值参与总成本', () => {
  const withoutLiner = cloneDefaultParams();
  withoutLiner.liner.sheets = 0;
  withoutLiner.liner.setupFee = 0;
  withoutLiner.liner.pricePerPrint = 0;

  const a = calcOrder(DEFAULT_PARAMS);
  const b = calcOrder(withoutLiner);
  assert.ok(a.costTotal > b.costTotal, '衬纸成本应计入总额');
  assert.ok(a.modules.liner.perBook > 0, '衬纸每本应有成本');
});

test('张数为 0 = 该部件不存在：纸、上机费、备损印张、后工艺全部不计', () => {
  // 2026-11-23 回归：以前只把纸张算 0，衬纸仍收 ¥0.0612/本（上机费+备损印张），
  // 用户看到的是「删掉衬纸报价还带着这笔钱」。
  const liner = cloneDefaultParams();
  liner.liner.sheets = 0;
  const rl = calcOrder(liner);
  assert.equal(rl.modules.liner.perBook, 0, '衬纸清零后每本应为 0');
  assert.equal(rl.modules.liner.detail.printCost, 0, '衬纸清零后上机费与备损费应为 0');
  assert.equal(rl.modules.liner.detail.finalSheets, 0);
  // 回到原始 cs.md 基准（这条正是「关闭衬纸」的那组数）
  close(rl.costTotal, 3579.95512, 1e-5, '衬纸清零后总成本');
  assert.equal(rl.unitCost.toFixed(4), '3.5800');

  // 封面清零时后工艺（覆膜）也要一起消失
  const cover = cloneDefaultParams();
  cover.cover.sheets = 0;
  const rc = calcOrder(cover);
  assert.equal(rc.modules.cover.perBook, 0, '封面清零后每本应为 0');
  assert.equal(rc.modules.cover.detail.laminate, 0, '封面不要了，覆膜不该继续收');
  assert.equal(rc.modules.cover.detail.printCost, 0);

  // 上机费写成多少都不影响（张数 0 就不进这条计价）
  const still = cloneDefaultParams();
  still.liner.sheets = 0;
  still.liner.setupFee = 999;
  still.liner.pricePerPrint = 9;
  close(calcOrder(still).costTotal, rl.costTotal, 1e-9, '张数 0 后上机费多少都不该影响');
});

test('封面工艺开关：关闭时后工艺为 0', () => {
  const p = cloneDefaultParams();
  p.cover.laminate = false;
  p.cover.foil = false;
  p.cover.uv = false;
  const m = calcProcessModule(p.cover, 1000);
  assert.equal(m.detail.laminate, 0);
  assert.equal(m.detail.foil, 0);
  assert.equal(m.detail.uv, 0);
  assert.equal(m.processPerBook, 0);
});

test('封面烫金按手计价并计入每本', () => {
  const p = cloneDefaultParams();
  p.cover.foil = true;
  p.cover.foilPrice = 0.1;
  const m = calcProcessModule(p.cover, 1000);
  close(m.detail.foil, 50, 1e-9, '烫金 1000÷2×0.1');
  close(m.detail.baseSheets, 500, 1e-9, '每手本数');
});

test('毛利分档：5/10/15%', () => {
  const tiers = profitTiers(DEFAULT_PARAMS);
  assert.equal(tiers.length, 3);
  const r = calcOrder(DEFAULT_PARAMS);
  close(tiers[0].finalQuote, r.costTotal * 1.05, 1e-6, '5% 档');
  close(tiers[1].finalQuote, r.costTotal * 1.1, 1e-6, '10% 档');
  close(tiers[2].finalQuote, r.costTotal * 1.15, 1e-6, '15% 档');
});

test('订单数量为 0 或负数时不崩（按 1 本兜底）', () => {
  const p = cloneDefaultParams();
  p.orderQty = 0;
  const r = calcOrder(p);
  assert.equal(r.orderQty, 1);
  assert.ok(Number.isFinite(r.costTotal));
  assert.ok(Number.isFinite(r.unitFinalPrice));
});

test('空参数不产生 NaN', () => {
  const p = cloneDefaultParams();
  p.inner.len = Number.NaN as unknown as number;
  const r = calcOrder(p);
  assert.ok(Number.isFinite(r.costTotal), 'NaN 输入应被兜成 0 而不是污染结果');
});

test('体检：默认参数无 error 级问题', () => {
  const issues = validateParams(DEFAULT_PARAMS);
  const errors = issues.filter((i) => i.level === 'error');
  assert.equal(errors.length, 0, `不该有 error：${errors.map((e) => e.title).join(', ')}`);
});

test('体检：离谱吨价会被抓出来', () => {
  const p = cloneDefaultParams();
  p.cover.ton = 88888;
  const issues = validateParams(p);
  assert.ok(
    issues.some((i) => i.field === 'cover.ton' && i.level === 'error'),
    '封面吨价 88888 应报 error',
  );
});

test('体检：衬纸尺寸与内页差太多会提醒', () => {
  const p = cloneDefaultParams();
  p.liner.len = 0.35;
  const issues = validateParams(p);
  assert.ok(issues.some((i) => i.code === 'liner-size'), '应提醒衬纸尺寸不一致');
});
