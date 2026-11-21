import { Capacitor } from '@capacitor/core';

/**
 * 自动更新（跨端）
 * - 桌面（Electron）：主进程负责请求、下载、退出后静默装
 * - 手机 / 浏览器：直接调 GitHub API 检查；能匿名读公开仓库时打开下载链接
 *
 * token 是可选的：公开仓库匿名即可检查更新；若更新源是私有仓库，
 * 匿名访问会返回 404，需要在设置里填一个只读 token。
 */

export interface UpdateAsset {
  id?: number;
  name: string;
  size: number;
  apiUrl?: string;
  downloadUrl: string;
}

export interface UpdateResult {
  ok: boolean;
  /** auth | not-found | bad-source | http-* | network */
  reason?: string;
  current: string;
  latest?: string;
  hasUpdate?: boolean;
  tag?: string;
  name?: string;
  notes?: string;
  publishedAt?: string;
  assets?: UpdateAsset[];
}

export interface UpdateSource {
  owner: string;
  repo: string;
}

export const DEFAULT_SOURCE: UpdateSource = { owner: 'Neutron-Fair', repo: 'Margin' };

declare const __APP_VERSION__: string;

interface DesktopUpdater {
  current(): Promise<{ version: string; platform: string }>;
  check(opts: { owner: string; repo: string; token: string }): Promise<UpdateResult>;
  download(opts: { apiUrl: string; name: string; token: string }): Promise<{ ok: boolean; path: string; size: number; expected: number }>;
  install(filePath: string): Promise<{ ok: boolean }>;
  onProgress(cb: (p: { received: number; total: number }) => void): () => void;
}

function desktopUpdater(): DesktopUpdater | undefined {
  return (window as Window & { coilbook?: { updater?: DesktopUpdater } }).coilbook?.updater;
}

export function isDesktop(): boolean {
  return Boolean(desktopUpdater());
}

export function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function currentVersion(): Promise<string> {
  const d = desktopUpdater();
  if (d) {
    try {
      return (await d.current()).version;
    } catch {
      /* 退回构建期注入的版本 */
    }
  }
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
}

function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** 桌面走主进程；手机/浏览器走 fetch。两边的返回结构保持一致。 */
export async function checkForUpdate(source: UpdateSource, token: string): Promise<UpdateResult> {
  const d = desktopUpdater();
  if (d) return d.check({ owner: source.owner, repo: source.repo, token });

  const current = await currentVersion();
  const url = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases/latest`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
    });
  } catch {
    return { ok: false, reason: 'network', current };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth', current };
  if (res.status === 404) return { ok: false, reason: 'not-found', current };
  if (!res.ok) return { ok: false, reason: `http-${res.status}`, current };

  const rel = (await res.json()) as {
    tag_name?: string;
    name?: string;
    body?: string;
    published_at?: string;
    assets?: Array<{ id: number; name: string; size: number; url: string; browser_download_url: string }>;
  };
  const latest = String(rel.tag_name || '').replace(/^v/i, '');
  return {
    ok: true,
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    tag: rel.tag_name,
    name: rel.name || rel.tag_name,
    notes: rel.body || '',
    publishedAt: rel.published_at || '',
    assets: (rel.assets || []).map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      apiUrl: a.url,
      downloadUrl: a.browser_download_url,
    })),
  };
}

/** 桌面端：下载安装包到临时目录，返回路径与进度订阅。 */
export async function downloadUpdate(
  asset: UpdateAsset,
  token: string,
  onProgress?: (p: { received: number; total: number }) => void,
): Promise<{ path: string; size: number }> {
  const d = desktopUpdater();
  if (!d) throw new Error('当前平台不支持在应用内下载安装包');
  if (!asset.apiUrl) throw new Error('该更新包缺少下载地址');
  const off = onProgress ? d.onProgress(onProgress) : () => {};
  try {
    const res = await d.download({ apiUrl: asset.apiUrl, name: asset.name, token });
    return { path: res.path, size: res.size };
  } finally {
    off();
  }
}

/** 桌面端：退出应用并静默安装（先卸载后安装，见主进程注释）。 */
export async function installUpdate(filePath: string): Promise<void> {
  const d = desktopUpdater();
  if (!d) throw new Error('当前平台不支持在应用内安装');
  await d.install(filePath);
}

/**
 * 手机/浏览器：打开下载链接交给系统浏览器。
 * 私有仓库的直链需要登录态，匿名打开会 404 —— 这种情况由调用方提示填 token。
 */
export function openDownload(url: string): void {
  window.open(url, '_blank', 'noopener');
}

/** 从资产列表里挑出当前平台该用的包。 */
export function pickAsset(assets: UpdateAsset[] | undefined): UpdateAsset | undefined {
  if (!assets || assets.length === 0) return undefined;
  if (isDesktop()) return assets.find((a) => /\.exe$/i.test(a.name));
  if (isAndroid()) return assets.find((a) => /\.apk$/i.test(a.name));
  return undefined;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
