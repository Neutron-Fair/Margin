import type { OrderParams } from '../engine/types.ts';
import { cloneDefaultParams, DEFAULT_PARAMS } from '../engine/defaults.ts';
import { todayISO } from '../ui/utils.ts';

export interface DocMeta {
  /** 单号 */
  no: string;
  /** 客户 */
  client: string;
  /** 报价日期 */
  date: string;
  /** 备注 */
  note: string;
}

export interface Scheme {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  params: OrderParams;
  doc: DocMeta;
}

export interface UserPreset {
  id: string;
  group: string;
  name: string;
  desc?: string;
  target: string;
  values: Array<{ path: string; value: number | string }>;
  builtin?: boolean;
}

export interface Settings {
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  ocr: {
    mode: 'local' | 'cloud';
    cloudBaseUrl: string;
    cloudApiKey: string;
    cloudModel: string;
  };
  /** 自动更新的拉取源（GitHub 仓库）；token 另存系统安全存储，不落普通设置 */
  update: {
    owner: string;
    repo: string;
  };
}

const KEY_DRAFT = 'cbc.draft.v1';
const KEY_SCHEMES = 'cbc.schemes.v1';
const KEY_PRESETS = 'cbc.presets.v1';
const KEY_SETTINGS = 'cbc.settings.v1';

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  // 必须向调用方报告失败；不能声称未写入的数据已保存。
  localStorage.setItem(key, value);
};

/** 递归补全缺失字段：老版本方案载入时不至于缺 key 崩掉 */
function mergeParams(base: OrderParams, patch: unknown): OrderParams {
  if (!patch || typeof patch !== 'object') return base;
  const out = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  const src = patch as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const bv = out[k];
    const pv = src[k];
    if (pv === undefined) continue;
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = mergeParams(bv as OrderParams, pv) as unknown as Record<string, unknown>;
    } else if (pv !== null) {
      out[k] = pv;
    }
  }
  return out as unknown as OrderParams;
}

export function defaultDoc(): DocMeta {
  return { no: '', client: '', date: todayISO(), note: '' };
}

export function loadDraft(): { params: OrderParams; doc: DocMeta } {
  const raw = safeParse<{ params?: unknown; doc?: unknown }>(read(KEY_DRAFT), {});
  return {
    params: mergeParams(cloneDefaultParams(), raw.params),
    doc: { ...defaultDoc(), ...(raw.doc as Partial<DocMeta> | undefined) },
  };
}

export function saveDraft(params: OrderParams, doc: DocMeta) {
  write(KEY_DRAFT, JSON.stringify({ params, doc, savedAt: Date.now() }));
}

export function resetDraft() {
  const params = JSON.parse(JSON.stringify(DEFAULT_PARAMS)) as OrderParams;
  const doc = defaultDoc();
  saveDraft(params, doc);
  return { params, doc };
}

export function loadSchemes(): Scheme[] {
  const list = safeParse<Scheme[]>(read(KEY_SCHEMES), []);
  return Array.isArray(list)
    ? list.map((scheme) => ({ ...scheme, params: mergeParams(cloneDefaultParams(), scheme.params) }))
    : [];
}

export function saveSchemes(list: Scheme[]) {
  write(KEY_SCHEMES, JSON.stringify(list));
}

export function loadUserPresets(): UserPreset[] {
  const list = safeParse<UserPreset[]>(read(KEY_PRESETS), []);
  return Array.isArray(list) ? list : [];
}

export function saveUserPresets(list: UserPreset[]) {
  write(KEY_PRESETS, JSON.stringify(list));
}

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    apiKey: '',
    model: 'mimo-v2.6-flash',
  },
  ocr: {
    mode: 'local',
    cloudBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    cloudApiKey: '',
    cloudModel: 'mimo-v2.6-pro',
  },
  update: {
    owner: 'Neutron-Fair',
    repo: 'Margin',
  },
};

export function loadSettings(): Settings {
  const raw = safeParse<Partial<Settings>>(read(KEY_SETTINGS), {});
  return {
    ai: { ...DEFAULT_SETTINGS.ai, ...(raw.ai ?? {}) },
    ocr: { ...DEFAULT_SETTINGS.ocr, ...(raw.ocr ?? {}) },
    update: { ...DEFAULT_SETTINGS.update, ...(raw.update ?? {}) },
  };
}

export function saveSettings(s: Settings) {
  // 密钥只允许经系统安全存储保存，禁止调用方误写入普通设置。
  write(KEY_SETTINGS, JSON.stringify({ ...s, ai: { ...s.ai, apiKey: '' }, ocr: { ...s.ocr, cloudApiKey: '' } }));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** 递归校验已知字段的类型，兼容旧版本中缺少的字段。 */
function validShape(value: unknown, template: unknown): boolean {
  if (isRecord(template)) {
    if (!isRecord(value)) return false;
    return Object.entries(value).every(([key, val]) =>
      Object.hasOwn(template, key) && validShape(val, template[key]));
  }
  return typeof value === typeof template && (typeof value !== 'number' || Number.isFinite(value));
}

/** 导出不含任何密钥的备份。 */
export function exportAll() {
  const settings = loadSettings();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    draft: loadDraft(),
    schemes: loadSchemes(),
    presets: loadUserPresets(),
    settings: {
      ai: { baseUrl: settings.ai.baseUrl, model: settings.ai.model },
      ocr: { mode: settings.ocr.mode, cloudBaseUrl: settings.ocr.cloudBaseUrl, cloudModel: settings.ocr.cloudModel },
    },
  };
}

export function importAll(data: unknown): { ok: boolean; message: string } {
  if (!isRecord(data) || (data.version !== undefined && data.version !== 1))
    return { ok: false, message: '备份格式或版本不支持' };
  const d = data;
  const defaults = cloneDefaultParams();
  const validDoc = (doc: unknown) => isRecord(doc) && validShape(doc, defaultDoc());
  const validParams = (params: unknown) => isRecord(params) && validShape(params, defaults);
  if (d.draft !== undefined && (!isRecord(d.draft) || !validParams(d.draft.params) || !validDoc(d.draft.doc)))
    return { ok: false, message: '草稿格式不正确，未导入任何数据' };
  if (d.schemes !== undefined && (!Array.isArray(d.schemes) || !d.schemes.every((s) =>
    isRecord(s) && typeof s.id === 'string' && typeof s.name === 'string' &&
    typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) &&
    typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) &&
    validParams(s.params) && validDoc(s.doc))))
    return { ok: false, message: '方案格式不正确，未导入任何数据' };
  if (d.presets !== undefined && (!Array.isArray(d.presets) || !d.presets.every((p) =>
    isRecord(p) && typeof p.id === 'string' && typeof p.group === 'string' &&
    typeof p.name === 'string' && typeof p.target === 'string' && Array.isArray(p.values) &&
    p.values.every((v) => isRecord(v) && typeof v.path === 'string' &&
      (typeof v.value === 'string' || (typeof v.value === 'number' && Number.isFinite(v.value)))))))
    return { ok: false, message: '预设格式不正确，未导入任何数据' };
  if (d.settings !== undefined && (!isRecord(d.settings) ||
    (d.settings.ai !== undefined && !isRecord(d.settings.ai)) ||
    (d.settings.ocr !== undefined && !isRecord(d.settings.ocr))))
    return { ok: false, message: '设置格式不正确，未导入任何数据' };

  const updates: Array<[string, string]> = [];
  if (d.draft !== undefined) updates.push([KEY_DRAFT, JSON.stringify(d.draft)]);
  if (d.schemes !== undefined) updates.push([KEY_SCHEMES, JSON.stringify(d.schemes)]);
  if (d.presets !== undefined) updates.push([KEY_PRESETS, JSON.stringify(d.presets)]);
  if (isRecord(d.settings)) {
    const existing = loadSettings();
    const ai = isRecord(d.settings.ai) ? d.settings.ai : {};
    const ocr = isRecord(d.settings.ocr) ? d.settings.ocr : {};
    // 旧版备份可能含明文密钥，绝不导入或覆盖现有密钥。
    const cleaned = {
      ai: { ...existing.ai, baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl : existing.ai.baseUrl, model: typeof ai.model === 'string' ? ai.model : existing.ai.model },
      ocr: { ...existing.ocr, mode: ocr.mode === 'local' || ocr.mode === 'cloud' ? ocr.mode : existing.ocr.mode, cloudBaseUrl: typeof ocr.cloudBaseUrl === 'string' ? ocr.cloudBaseUrl : existing.ocr.cloudBaseUrl, cloudModel: typeof ocr.cloudModel === 'string' ? ocr.cloudModel : existing.ocr.cloudModel },
    };
    updates.push([KEY_SETTINGS, JSON.stringify(cleaned)]);
  }
  const previous = new Map<string, string | null>();
  try {
    for (const [key] of updates) previous.set(key, localStorage.getItem(key));
    for (const [key, value] of updates) write(key, value);
    return { ok: true, message: '导入完成（密钥未导入）' };
  } catch {
    let rollbackFailed = false;
    for (const [key, value] of previous) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      catch { rollbackFailed = true; }
    }
    return { ok: false, message: rollbackFailed ? '导入失败，部分数据可能已更改，请检查原数据' : '导入失败，已尝试恢复原数据' };
  }
}
