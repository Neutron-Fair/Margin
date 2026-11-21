import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaultParams } from '../src/engine/defaults.ts';
import { validateParams, validateSafety } from '../src/engine/validate.ts';

const paths = [
  'orderQty', ...['inner', 'liner', 'cover', 'back'].flatMap(k =>
    ['len', 'wid', 'gram', 'ton', 'sheets', 'paperWaste', 'imposition', 'wasteSheets', 'setupFee', 'pricePerPrint'].map(f => `${k}.${f}`)),
  'cover.foilPrice', 'cover.uvPrice', 'back.foilPrice', 'back.uvPrice',
  ...['len', 'wid', 'gram', 'ton', 'sheetsPerBook', 'paperWaste'].map(f => `gray.${f}`),
  ...['coilPrice', 'coilsPerBook', 'bindingFee', 'packagingFee', 'fixedOverhead', 'wasteRate'].map(f => `misc.${f}`),
  'profitTax.profitRate', 'profitTax.taxRate',
];

test('全部数值字段拒绝负数、非有限值、字符串和缺失值', () => {
  for (const path of paths) for (const value of [-1, NaN, Infinity, '12', undefined]) {
    const p = cloneDefaultParams();
    const parts = path.split('.');
    let target: any = p;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts.at(-1)!] = value;
    assert.ok(validateSafety(p).some(i => i.code === `invalid:${path}`), `${path}: ${String(value)}`);
    assert.ok(validateParams(p).some(i => i.code === `invalid:${path}`));
  }
});

test('数量和张数必须是安全整数，拼版和订单必须为正', () => {
  const p = cloneDefaultParams();
  p.orderQty = 0; p.inner.imposition = 0; p.cover.wasteSheets = 0.5;
  const codes = validateSafety(p).map(i => i.code);
  for (const path of ['orderQty', 'inner.imposition', 'cover.wasteSheets']) assert.ok(codes.includes(`invalid:${path}`));
});

test('非法枚举、工艺开关和数值计算溢出被拒绝', () => {
  const p = cloneDefaultParams();
  p.inner.printSide = 'bad' as any;
  p.cover.foil = 'false' as any;
  assert.ok(validateSafety(p).some(i => i.field === 'inner.printSide'));
  assert.ok(validateSafety(p).some(i => i.field === 'cover.foil'));
  const big = cloneDefaultParams();
  big.inner.ton = Number.MAX_VALUE; big.inner.gram = Number.MAX_VALUE;
  assert.ok(validateSafety(big).some(i => i.code === 'invalid:result'));
});

test('运费拒绝负数、非有限值、错误类型，并拒绝到货价溢出', () => {
  for (const value of [-1, NaN, Infinity, '3', null]) {
    const p = cloneDefaultParams();
    p.shippingFee = value as number;
    assert.ok(validateSafety(p).some(i => i.field === 'shippingFee'));
  }
  const p = cloneDefaultParams();
  p.shippingFee = undefined;
  assert.deepEqual(validateSafety(p), []);
  p.shippingFee = Number.MAX_VALUE;
  p.misc.fixedOverhead = Number.MAX_VALUE / 2;
  assert.ok(validateSafety(p).some(i => i.code === 'invalid:result'));
});

test('默认参数与允许的零值通过安全检查', () => {
  const p = cloneDefaultParams();
  p.liner.sheets = 0; p.liner.setupFee = 0; p.liner.pricePerPrint = 0;
  assert.deepEqual(validateSafety(p), []);
});
