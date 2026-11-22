import { Capacitor } from '@capacitor/core';

/**
 * 自动更新（跨端）
 * - 桌面（Electron）：主进程负责请求、下载、退出后静默装
 * - 手机 / 浏览器：直接调 API 检查；能匿名读公开仓库时打开下载链接
 *
 * 更新源：**优先 GitHub，不可用时退回 Gitee**。
 * Gitee 的 release 附件单文件上限 100MB，安装包超过时按 `.part1/.part2` 分片，
 * 桌面端下载后拼接并校验 SHA-256（清单见 `<安装包名>.parts.json`）。
 *
 * token 是可选的：公开仓库匿名即可检查更新；若更新源是私有仓库，
 * 匿名访问会返回 404，需要在设置里填一个只读 token（只对 GitHub 生效）。
 */

export interface UpdateAsset {
  id?: number;
  name: string;
  size: number;
  apiUrl?: string;
  downloadUrl: string;
}

export type UpdateSourceKind = 'github' | 'gitee';

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
  /** Release 页面地址：没有可用安装包时用它兜底「打开下载页」 */
  htmlUrl?: string;
  /** 这次结果实际来自哪个源 */
  source?: UpdateSourceKind;
  /** 失败时的诊断补充（主进程已翻译成人话，例如「TLS 证书校验失败（证书链不完整）」） */
  detail?: string;
  /**
   * 同版本的另一个下载源（检查用 GitHub 拿到最新，下载优先用它）。
   * 实测：本机到 GitHub Release 只有 ~29KB/s，Gitee 有 ~2.1MB/s，
   * 149MB 的包一个要 85 分钟、一个 90 秒，所以下载不该跟着检查源走。
   */
  mirror?: {
    source: UpdateSourceKind;
    assets: UpdateAsset[];
    htmlUrl: string;
    notes?: string;
  };
}

export interface UpdateSource {
  owner: string;
  repo: string;
}

/** 两个源分开配置：GitHub 是 Neutron-Fair/Margin，Gitee 是 neutronfair/Margin */
export interface UpdateSources {
  github: UpdateSource;
  gitee: UpdateSource;
}

/** 分片清单：由发布脚本生成，随分片一起上传 */
export interface PartsManifest {
  name: string;
  size: number;
  sha256: string;
  parts: Array<{ name: string; size: number }>;
}

/** 安装方式：单包 / 分片 / 只能去网页；source 表示这个包会从哪个源下载 */
export type InstallPlan =
  | { kind: 'single'; asset: UpdateAsset; source?: UpdateSourceKind }
  | {
      kind: 'parts';
      parts: UpdateAsset[];
      manifestUrl?: string;
      htmlUrl: string;
      source?: UpdateSourceKind;
    }
  | { kind: 'page'; htmlUrl: string; source?: UpdateSourceKind };

export const DEFAULT_SOURCE: UpdateSource = { owner: 'Neutron-Fair', repo: 'Margin' };

declare const __APP_VERSION__: string;

interface DesktopUpdater {
  current(): Promise<{ version: string; platform: string }>;
  check(opts: { owner: string; repo: string; token: string }): Promise<UpdateResult>;
  download(opts: { apiUrl: string; name: string; token: string }): Promise<{ ok: boolean; path: string; size: number; expected: number }>;
  downloadParts?(opts: {
    urls: string[];
    name: string;
    expectedSize?: number;
    expectedSha256?: string;
  }): Promise<{ ok: boolean; path: string; size: number }>;
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

const enc = (s: string) => encodeURIComponent(s);

interface RawAsset {
  id?: number;
  name?: string;
  size?: number;
  url?: string;
  browser_download_url?: string;
}

function toAssets(raw: RawAsset[] | undefined, dropSourceArchives: boolean): UpdateAsset[] {
  const list = (raw || []).filter((a) => typeof a?.name === 'string' && a.name);
  return list
    // Gitee 会自动附带 tag 的源码包（xxx.zip / xxx.tar.gz），不是安装包
    .filter((a) => !(dropSourceArchives && /\.(zip|tar\.gz)$/i.test(String(a.name))))
    .map((a) => ({
      id: a.id,
      name: String(a.name),
      size: Number(a.size) || 0,
      apiUrl: a.url,
      downloadUrl: String(a.browser_download_url || ''),
    }));
}

async function fetchGithubRelease(src: UpdateSource, token: string, current: string): Promise<UpdateResult> {
  const url = `https://api.github.com/repos/${enc(src.owner)}/${enc(src.repo)}/releases/latest`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
    });
  } catch (e) {
    return {
      ok: false,
      reason: 'network',
      current,
      detail: e instanceof Error ? e.message : undefined,
    };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth', current };
  if (res.status === 404) return { ok: false, reason: 'not-found', current };
  if (!res.ok) return { ok: false, reason: `http-${res.status}`, current };

  const rel = (await res.json()) as {
    tag_name?: string;
    name?: string;
    body?: string;
    published_at?: string;
    html_url?: string;
    assets?: RawAsset[];
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
    htmlUrl: rel.html_url || '',
    assets: toAssets(rel.assets, false),
    source: 'github',
  };
}

async function fetchGiteeRelease(src: UpdateSource, current: string): Promise<UpdateResult> {
  const base = `https://gitee.com/${src.owner}/${src.repo}`;
  const url = `https://gitee.com/api/v5/repos/${enc(src.owner)}/${enc(src.repo)}/releases/latest`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    return {
      ok: false,
      reason: 'network',
      current,
      detail: e instanceof Error ? e.message : undefined,
    };
  }
  if (res.status === 404) return { ok: false, reason: 'not-found', current };
  if (!res.ok) return { ok: false, reason: `http-${res.status}`, current };

  const rel = (await res.json()) as {
    tag_name?: string;
    name?: string;
    body?: string;
    created_at?: string;
    assets?: RawAsset[];
  };
  const tag = String(rel.tag_name || '');
  const latest = tag.replace(/^v/i, '');
  return {
    ok: true,
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    tag,
    name: rel.name || tag,
    notes: rel.body || '',
    // Gitee 没有 published_at，用创建时间
    publishedAt: rel.created_at || '',
    htmlUrl: `${base}/releases/tag/${tag}`,
    assets: toAssets(rel.assets, true),
    source: 'gitee',
  };
}

/**
 * 检查更新：先查 GitHub，拿不到就退回 Gitee。
 * 两个源都失败时，返回 GitHub 的错误（更可能是用户关心的那个）。
 */
export async function checkForUpdate(sources: UpdateSources | UpdateSource, token: string): Promise<UpdateResult> {
  const both: UpdateSources =
    'github' in sources
      ? (sources as UpdateSources)
      : { github: sources as UpdateSource, gitee: { owner: 'neutronfair', repo: (sources as UpdateSource).repo } };

  const d = desktopUpdater();
  const current = await currentVersion();

  let gh: UpdateResult;
  if (d) {
    // 桌面端优先由主进程代发（它能带 token、能拿 assets.apiUrl，也不受 CORS 限制）
    let fromMain: UpdateResult | undefined;
    try {
      fromMain = await d.check({ owner: both.github.owner, repo: both.github.repo, token });
      if (fromMain) fromMain = { ...fromMain, source: 'github' };
    } catch {
      // 旧版主进程会把裸 IPC 错误抛上来，按「主进程没拿到」处理
      fromMain = undefined;
    }

    if (fromMain?.ok) {
      gh = fromMain;
    } else if (!fromMain || fromMain.reason === 'network') {
      /*
       * 主进程没连上时在渲染层重试一次：主进程的 Node 栈用 Node 内置 CA bundle，
       * 本机可能缺中间证书（unable to verify the first certificate）；
       * 渲染层走 Chromium 网络栈，用 Windows 系统证书库，通常能过。
       */
      const viaRenderer = await fetchGithubRelease(both.github, token, current);
      gh = viaRenderer.ok ? viaRenderer : fromMain || viaRenderer;
    } else {
      gh = fromMain;
    }
  } else {
    gh = await fetchGithubRelease(both.github, token, current);
  }
  if (gh.ok) {
    /*
     * GitHub 通了也顺手问一次 Gitee：把它的资产挂成 mirror 供「下载」用。
     *
     * 为什么不让下载跟着检查源：实测本机 到 GitHub Release 约 29KB/s、
     * Gitee 约 2.1MB/s（149MB 包：85 分钟 vs 90 秒）。检查走 GitHub 拿最新，
     * 下载走 Gitee 才符合实际体验。
     *
     * 版本必须「严格相等」才挂镜像：若 Gitee 比 GitHub 新，用它的资产会出现
     * 「提示 v1.2.4、实际下载 v1.2.5」的错配。
     */
    try {
      const gt = await fetchGiteeRelease(both.gitee, current);
      if (gt.ok && compareVersions(String(gt.latest || '0'), String(gh.latest || '0')) === 0) {
        gh.mirror = { source: 'gitee', assets: gt.assets ?? [], htmlUrl: gt.htmlUrl || '', notes: gt.notes };
      }
    } catch {
      /* 拿不到镜像不影响检查结果，只是下载仍回落到 GitHub */
    }
    return gh;
  }

  // GitHub 不可用（网络/限流/仓库异常）→ 退到 Gitee
  const gt = await fetchGiteeRelease(both.gitee, current);
  return gt.ok ? gt : gh;
}

/** 从资产名里取分片序号，用于排序 */
function partIndex(name: string): number {
  const m = /\.part(\d+)$/i.exec(name);
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * 决定怎么装：单包直下 / 分片拼接 / 只能去网页。
 *
 * 顺序按「源」而不是按「包形态」排：mirror（Gitee，快）整池优先，
 * 只有它没货时才用检查源的资产（GitHub 单包，实测下载很慢）。
 */
export function planInstall(result: UpdateResult): InstallPlan {
  const pools: Array<{ assets: UpdateAsset[]; htmlUrl: string; source?: UpdateSourceKind }> = [];
  if (result.mirror) {
    pools.push({
      assets: result.mirror.assets ?? [],
      htmlUrl: result.mirror.htmlUrl || result.htmlUrl || '',
      source: result.mirror.source,
    });
  }
  pools.push({ assets: result.assets ?? [], htmlUrl: result.htmlUrl || '', source: result.source });

  for (const pool of pools) {
    const plan = pickFromPool(pool.assets, pool.htmlUrl);
    if (plan.kind !== 'page') return { ...plan, source: pool.source };
  }
  return { kind: 'page', htmlUrl: result.mirror?.htmlUrl || result.htmlUrl || '', source: result.source };
}

/** 单池内挑包：有单包就单包，否则看分片，都没有就交回网页 */
function pickFromPool(assets: UpdateAsset[], htmlUrl: string): InstallPlan {
  if (isDesktop()) {
    const exe = assets.find((a) => /\.exe$/i.test(a.name));
    if (exe) return { kind: 'single', asset: exe };
    const parts = assets
      .filter((a) => /\.exe\.part\d+$/i.test(a.name))
      .sort((a, b) => partIndex(a.name) - partIndex(b.name));
    if (parts.length > 0) {
      const manifest = assets.find((a) => /\.exe\.parts\.json$/i.test(a.name));
      return { kind: 'parts', parts, manifestUrl: manifest?.downloadUrl, htmlUrl };
    }
    return { kind: 'page', htmlUrl };
  }
  if (isAndroid()) {
    const apk = assets.find((a) => /\.apk$/i.test(a.name));
    if (apk) return { kind: 'single', asset: apk };
    return { kind: 'page', htmlUrl };
  }
  return { kind: 'page', htmlUrl };
}

export interface ReleaseChecksum {
  size: number;
  sha256: string;
}

/**
 * 从 Release 说明里解析安装包校验值。
 *
 * 为什么不用分片清单文件直接读：Gitee 的下载直链没有 CORS 头，渲染层 fetch 读不到；
 * 而发布说明里固定写着「… 字节，SHA-256 `…`」这两行，解析它零成本且两种源都通用。
 */
export function parseChecksums(notes: string | undefined): { exe?: ReleaseChecksum; apk?: ReleaseChecksum } {
  const out: { exe?: ReleaseChecksum; apk?: ReleaseChecksum } = {};
  if (!notes) return out;
  const grab = (re: RegExp): ReleaseChecksum | undefined => {
    const m = re.exec(notes);
    if (!m) return undefined;
    const size = Number(String(m[1]).replace(/[,_\s]/g, ''));
    if (!Number.isFinite(size) || size <= 0) return undefined;
    return { size, sha256: m[2].toUpperCase() };
  };
  out.exe = grab(/(?:Windows\s*安装包|安装包)[：:]\s*([\d,_\s]+)\s*字节[，,、]?\s*SHA-256\s*`([A-Fa-f0-9]{64})`/);
  out.apk = grab(/(?:Android\s*APK|APK)[：:]\s*([\d,_\s]+)\s*字节[，,、]?\s*SHA-256\s*`([A-Fa-f0-9]{64})`/);
  return out;
}

/** 读取分片清单（可选；读不到就只按总大小校验） */
export async function loadPartsManifest(url: string | undefined): Promise<PartsManifest | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const raw = (await res.json()) as Partial<PartsManifest>;
    if (!raw || typeof raw.sha256 !== 'string' || !Array.isArray(raw.parts)) return undefined;
    return {
      name: String(raw.name || ''),
      size: Number(raw.size) || 0,
      sha256: raw.sha256,
      parts: raw.parts.map((p) => ({ name: String(p?.name || ''), size: Number(p?.size) || 0 })),
    };
  } catch {
    return undefined;
  }
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

/** 桌面端：下载全部分片、拼接、校验后返回安装包路径。 */
export async function downloadParts(
  parts: UpdateAsset[],
  manifest: PartsManifest | undefined,
  onProgress?: (p: { received: number; total: number }) => void,
): Promise<{ path: string; size: number }> {
  const d = desktopUpdater();
  if (!d?.downloadParts) throw new Error('当前环境不支持分片下载');
  if (parts.length === 0) throw new Error('没有可下载的分片');
  const name = manifest?.name || parts[0].name.replace(/\.part\d+$/i, '');
  const off = onProgress ? d.onProgress(onProgress) : () => {};
  try {
    const res = await d.downloadParts({
      urls: parts.map((p) => p.downloadUrl),
      name,
      expectedSize: manifest?.size,
      expectedSha256: manifest?.sha256,
    });
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

/** 从资产列表里挑出当前平台该用的包（单包场景；分片请用 planInstall）。 */
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
