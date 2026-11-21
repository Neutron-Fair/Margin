import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, parseOrderText, sanitizePatch } from '../src/ai/params.ts';
import { cloneDefaultParams } from '../src/engine/defaults.ts';

test('本地文字仅更新已识别项，保留用户修改的其他参数', () => {
  const p = cloneDefaultParams();
  p.inner.ton = 8888; p.back.foil = true;
  const changes: Record<string, unknown> = {};
  const count = applyPatch(parseOrderText('2000本'), p, (path, value) => { changes[path] = value; });
  assert.equal(count, 1);
  assert.deepEqual(changes, { orderQty: 2000 });
});

test('否定工艺不会误启用，且不隐式修改封底', () => {
  const patch = parseOrderText('封面不覆膜，不烫金，无UV');
  assert.equal(patch['cover.laminate'], false);
  assert.equal(patch['cover.foil'], false);
  assert.equal(patch['cover.uv'], false);
  assert.equal(patch['back.laminate'], undefined);
  assert.equal(parseOrderText('封底无需覆膜')['back.laminate'], false);
  assert.equal(parseOrderText('封面覆膜')['cover.laminate'], true);
});

test('仅接受合法白名单路径、类型和范围', () => {
  const patch = sanitizePatch(JSON.parse('{"orderQty":1200,"shippingFee":20,"inner":{"gram":80,"imposition":0,"printSide":"double","len":-1,"unknown":4},"cover":{"laminate":"false","foil":false},"__proto__":{"polluted":true},"bad":{"foo":12}}'));
  assert.deepEqual({ ...patch }, { orderQty: 1200, shippingFee: 20, 'inner.gram': 80, 'inner.printSide': 'double', 'cover.foil': false });
  assert.deepEqual({ ...sanitizePatch({ orderQty: Infinity, inner: { gram: NaN }, misc: { wasteRate: 101 } }) }, {});
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('尺寸只修改明确识别的内页尺寸', () => {
  const patch = parseOrderText('A5 80页');
  assert.equal(patch['inner.len'], 0.21);
  assert.equal(patch['inner.wid'], 0.148);
  assert.equal(patch['inner.sheets'], 40);
  assert.equal(patch['cover.len'], undefined);
});
