/** 按路径读写嵌套对象（用于配置化表单） */

export function getPath(obj: unknown, path: string): unknown {
  const segs = path.split('.');
  let cur: unknown = obj;
  for (const s of segs) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const segs = path.split('.');
  const clone: unknown = Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as object) };
  let cur = clone as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i];
    const next = cur[key];
    cur[key] = Array.isArray(next) ? [...next] : { ...(next as object) };
    cur = cur[key] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
  return clone as T;
}

/** 千分位 + 固定小数 */
export function fmtMoney(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const fixed = n.toFixed(digits);
  const [int, dec] = fixed.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${withSep}.${dec}` : withSep;
}

/** 单价类保留 4 位，去掉无意义的尾零 */
export function fmtUnit(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(4);
  return s.replace(/0+$/, '').replace(/\.$/, '') || '0';
}

/** 输入值格式化：去掉尾随 0 但保留有效位 */
export function fmtInput(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(digits);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function todayISO(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
