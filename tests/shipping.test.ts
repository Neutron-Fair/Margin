import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcOrder } from '../src/engine/calc.ts';
import { cloneDefaultParams } from '../src/engine/defaults.ts';
import { loadDraft, loadSchemes, saveDraft, saveSchemes, defaultDoc } from '../src/store/storage.ts';

test('运费独立于原报价、成本、利润和税', () => {
  const params = cloneDefaultParams();
  params.profitTax = { profitRate: 15, taxRate: 6 };
  const before = calcOrder(params);
  const after = calcOrder({ ...params, shippingFee: 125 });
  assert.deepEqual(after, before);
  assert.equal(after.finalQuote + 125, before.finalQuote + 125);
  assert.equal((after.finalQuote + 125) / after.orderQty, before.unitFinalPrice + 125 / after.orderQty);
});

test('草稿和方案保存运费，历史数据默认零运费', () => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  } });
  const params = cloneDefaultParams();
  params.shippingFee = 88;
  const doc = defaultDoc();
  saveDraft(params, doc);
  assert.equal(loadDraft().params.shippingFee, 88);
  saveSchemes([{ id: '1', name: '运费', createdAt: 0, updatedAt: 0, params, doc }]);
  assert.equal(loadSchemes()[0].params.shippingFee, 88);
  delete params.shippingFee;
  saveDraft(params, doc);
  saveSchemes([{ id: '2', name: '旧方案', createdAt: 0, updatedAt: 0, params, doc }]);
  assert.equal(loadDraft().params.shippingFee, 0);
  assert.equal(loadSchemes()[0].params.shippingFee, 0);
});
