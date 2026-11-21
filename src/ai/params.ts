import type { OrderParams } from '../engine/types.ts';

export type ParamPatch = Record<string, number | boolean | string>;

type Rule = { min: number; max: number; integer?: boolean } | 'boolean' | 'side';
const rules: Record<string, Rule> = Object.create(null);
const num = (path: string, min: number, max: number, integer = false) => { rules[path] = { min, max, integer }; };
num('orderQty', 1, 100000000, true);
num('shippingFee', 0, 100000000);
for (const module of ['inner', 'liner', 'cover', 'back']) {
  for (const field of ['len', 'wid']) num(`${module}.${field}`, 0.001, 5);
  num(`${module}.gram`, 1, 5000);
  num(`${module}.ton`, 0, 1000000);
  num(`${module}.sheets`, 0, 100000, true);
  num(`${module}.paperWaste`, 0, 100);
  num(`${module}.imposition`, 1, 10000, true);
  num(`${module}.wasteSheets`, 0, 100000000, true);
  rules[`${module}.printSide`] = 'side';
  num(`${module}.setupFee`, 0, 100000000);
  num(`${module}.pricePerPrint`, 0, 1000000);
}
for (const module of ['cover', 'back']) {
  for (const field of ['laminate', 'foil', 'uv']) rules[`${module}.${field}`] = 'boolean';
  for (const field of ['foilPrice', 'uvPrice']) num(`${module}.${field}`, 0, 1000000);
}
for (const field of ['len', 'wid']) num(`gray.${field}`, 0.001, 5);
num('gray.gram', 1, 5000); num('gray.ton', 0, 1000000);
num('gray.sheetsPerBook', 0, 100000, true); num('gray.paperWaste', 0, 100);
for (const field of ['coilPrice', 'bindingFee', 'packagingFee']) num(`misc.${field}`, 0, 1000000);
num('misc.coilsPerBook', 0, 100000, true); num('misc.fixedOverhead', 0, 100000000);
num('misc.wasteRate', 0, 100); num('profitTax.profitRate', 0, 100); num('profitTax.taxRate', 0, 100);

/** 只接受显式白名单中的叶子，拒绝未知路径、非有限数、错误类型及越界值。 */
export function sanitizePatch(input: unknown): ParamPatch {
  const out: ParamPatch = Object.create(null);
  const walk = (value: unknown, path: string) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue;
        walk(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    const rule = rules[path];
    if (!rule) return;
    if (rule === 'boolean') { if (typeof value === 'boolean') out[path] = value; }
    else if (rule === 'side') { if (value === 'single' || value === 'double') out[path] = value; }
    else if (typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max && (!rule.integer || Number.isSafeInteger(value))) out[path] = value;
  };
  walk(input, '');
  return out;
}

export function applyPatch(patch: ParamPatch, current: OrderParams, onChange: (path: string, value: unknown) => void): number {
  let count = 0;
  for (const [path, value] of Object.entries(patch)) {
    const [first, second] = path.split('.');
    const base = current as unknown as Record<string, unknown>;
    const old = second ? (base[first] as Record<string, unknown> | undefined)?.[second] : base[first];
    if (old !== value) { onChange(path, value); count++; }
  }
  return count;
}

/** 只提取明确出现的参数，不使用默认对象填补未知值。 */
export function parseOrderText(text: string): ParamPatch {
  const nested: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  nested.inner = inner;
  const qty = text.match(/(?:^|[^\d.\-])(\d+)\s*(?:本|册)/);
  if (qty) nested.orderQty = Number(qty[1]);
  const pages = text.match(/(?:^|[^\d.\-])(\d+)\s*(?:页|面)/);
  if (pages) inner.sheets = Math.ceil(Number(pages[1]) / 2);
  for (const [label, key] of [['内页', 'inner'], ['封面', 'cover'], ['封底', 'back']] as const) {
    const match = text.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:g|克)`, 'i'));
    if (match) { const part = (nested[key] ??= {}) as Record<string, unknown>; part.gram = Number(match[1]); }
  }
  const sizes: Record<string, [number, number]> = { a4: [0.297, 0.21], a5: [0.21, 0.148], a6: [0.148, 0.105], b5: [0.25, 0.176], '16k': [0.26, 0.185] };
  const standard = text.match(/\b(a4|a5|a6|b5|16k)\b/i);
  const dimensions = text.match(/(?:^|[^\d.\-])(\d{2,4})\s*[×x*]\s*(\d{2,4})\s*(?:mm|毫米)?/i);
  if (standard) [inner.len, inner.wid] = sizes[standard[1].toLowerCase()];
  else if (dimensions) { inner.len = Math.max(Number(dimensions[1]), Number(dimensions[2])) / 1000; inner.wid = Math.min(Number(dimensions[1]), Number(dimensions[2])) / 1000; }
  // 只在能判定目标时设置；无部位标识时按封面处理，避免隐式改变封底。
  for (const clause of text.split(/[，,。；;\n]/)) {
    const target = /封底/.test(clause) && !/封面/.test(clause) ? 'back' : 'cover';
    for (const [word, field] of [['覆膜', 'laminate'], ['烫金', 'foil'], ['(?:uv|上光)', 'uv']] as const) {
      const matches = [...clause.matchAll(new RegExp(`(不需要|无需|不要|不做|没有|取消|无|不|免)?\\s*(${word})`, 'gi'))];
      if (matches.length !== 1) continue;
      const m = matches[0];
      const after = clause.slice((m.index ?? 0) + m[0].length);
      if (/^\s*(?:不要|不做|无需|不需要|没有|取消|无|不|免)/.test(after)) continue;
      const part = (nested[target] ??= {}) as Record<string, unknown>;
      part[field] = !m[1];
    }
  }
  return sanitizePatch(nested);
}
