import { useEffect, useRef, useState } from 'react';
import { getUpdateToken, setUpdateToken } from '../../store/secrets.ts';
import { loadSettings, saveSettings, type Settings } from '../../store/storage.ts';
import {
  checkForUpdate,
  currentVersion,
  downloadParts,
  downloadUpdate,
  formatBytes,
  installUpdate,
  isAndroid,
  isDesktop,
  loadPartsManifest,
  openDownload,
  parseChecksums,
  planInstall,
  type UpdateAsset,
  type UpdateResult,
} from '../../updater/index.ts';

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span className="label">{label}</span>
      <div className="field">{children}</div>
    </div>
  );
}

/** 把 Release 的 Markdown 粗略压成纯文本，够看清改了什么即可 */
function plainNotes(md: string): string {
  return md
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function UpdatePanel({ onClose, onToast }: Props) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [token, setToken] = useState('');
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateResult | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const patchSource = (key: 'owner' | 'repo', value: string) => {
    const next = { ...settings, update: { ...settings.update, [key]: value } };
    setSettings(next);
    saveSettings(next);
  };

  const doCheck = async () => {
    setChecking(true);
    setError('');
    setInfo(null);
    try {
      if (token) await setUpdateToken(token).catch(() => undefined);
      const res = await checkForUpdate(
        {
          github: { owner: settings.update.owner, repo: settings.update.repo },
          gitee: { owner: settings.update.giteeOwner, repo: settings.update.giteeRepo },
        },
        token,
      );
      if (!res.ok) {
        const map: Record<string, string> = {
          auth: '凭据被拒绝：请到「高级」里填一个有 repo 只读权限的 GitHub Token',
          'not-found': '两个更新源都找不到 Release（GitHub 与 Gitee），或仓库还没发布版本',
          'bad-source': '仓库名不合法',
          network: '网络不可达：GitHub 与 Gitee 都没连上，检查代理或网络后重试',
        };
        const base = map[res.reason || ''] || `检查失败（${res.reason || '未知原因'}）`;
        // detail 是主进程翻译过的人话（如「TLS 证书校验失败（证书链不完整）」），附在后面便于排查
        setError(res.detail ? `${base}：${res.detail}` : base);
      } else {
        setInfo(res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  // 打开面板即自动检查：用户不需要填任何东西，也不用手点第一次
  const doCheckRef = useRef(doCheck);
  doCheckRef.current = doCheck;

  useEffect(() => {
    let active = true;
    (async () => {
      const v = await currentVersion();
      if (!active) return;
      setVersion(v);
      try {
        const t = await getUpdateToken();
        if (active) setToken(t);
      } catch {
        /* 安全存储不可用时只是不能存 token，不影响公开仓库检查 */
      }
      if (active) void doCheckRef.current();
    })();
    return () => {
      active = false;
    };
  }, []);

  const hasUpdate = Boolean(info?.ok && info.hasUpdate);
  const plan = hasUpdate ? planInstall(info as UpdateResult) : null;
  const sourceLabel = info?.source === 'gitee' ? 'Gitee' : info?.source === 'github' ? 'GitHub' : '';
  // 下载源可能和检查源不同（检查走 GitHub 拿最新，下载优先 Gitee 因为快得多）
  const downloadLabel =
    plan && plan.kind !== 'page' && plan.source && plan.source !== info?.source
      ? plan.source === 'gitee'
        ? 'Gitee'
        : 'GitHub'
      : '';
  // 分片的校验值写在对应源的发布说明里，镜像与主源的说明不能混用
  const downloadNotes = info?.mirror?.notes || info?.notes;

  // 没有当前平台的安装包时（比如浏览器里打开），退化成「打开下载页」
  const fallbackUrl =
    info?.htmlUrl ||
    (info?.tag
      ? `https://github.com/${settings.update.owner}/${settings.update.repo}/releases/tag/${info.tag}`
      : '');

  const doInstall = async () => {
    if (!plan) return;
    setError('');
    setInstalling(true);
    try {
      if (plan.kind === 'page') {
        openDownload(plan.htmlUrl || fallbackUrl);
        return;
      }
      if (plan.kind === 'single') {
        if (isDesktop()) {
          setProgress({ received: 0, total: plan.asset.size });
          const file = await downloadUpdate(plan.asset, token, (p) => setProgress(p));
          onToast(`安装包已下载（${formatBytes(file.size)}），2 秒后开始安装`);
          await installUpdate(file.path);
        } else if (isAndroid()) {
          openDownload(plan.asset.downloadUrl);
          onToast('已交给系统浏览器下载，下载完成后点开安装即可');
        } else {
          openDownload(plan.asset.downloadUrl);
        }
        return;
      }
      // parts：Gitee 的大安装包被切片，下载后拼接并校验
      // 清单文件在 Gitee 上没有 CORS（渲染层读不到），因此优先用清单、读不到就从发布说明里解析
      const manifest = await loadPartsManifest(plan.manifestUrl);
      const sums = parseChecksums(downloadNotes);
      const expected =
        manifest ??
        (sums.exe
          ? { name: plan.parts[0].name.replace(/\.part\d+$/i, ''), size: sums.exe.size, sha256: sums.exe.sha256, parts: [] }
          : undefined);
      const totalSize = expected?.size || plan.parts.reduce((sum, p) => sum + p.size, 0);
      setProgress({ received: 0, total: totalSize });
      const file = await downloadParts(plan.parts, expected, (p) => setProgress(p));
      onToast(`安装包已下载并校验通过（${formatBytes(file.size)}），2 秒后开始安装`);
      await installUpdate(file.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载或安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;

  // 只留一个按钮：语义随状态走，用户永远只需点这一个
  const action = hasUpdate
    ? plan && plan.kind !== 'page'
      ? {
          label: installing ? '处理中…' : isDesktop() ? '下载并安装' : '打开下载页',
          run: doInstall,
          disabled: installing,
          accent: true,
        }
      : { label: '打开下载页', run: doInstall, disabled: installing || !fallbackUrl, accent: true }
    : { label: checking ? '检查中…' : info || error ? '重新检查' : '检查更新', run: doCheck, disabled: checking || installing, accent: false };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="检查更新">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">UPDATE</span>
            检查更新
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <Row label="当前版本">
            <div className="update-version num">{version || '…'}</div>
          </Row>

          {checking && <div className="update-status">正在检查有没有新版本…</div>}

          {!checking && info?.ok && !info.hasUpdate && (
            <div className="update-status is-ok">
              已是最新版本（{info.current}）{sourceLabel && <span className="update-source">· {sourceLabel}</span>}
            </div>
          )}

          {error && <div className="update-error">{error}</div>}

          {!checking && hasUpdate && (
            <div className="update-found">
              <div className="update-found-head">
                <b className="num">v{info?.latest}</b>
                <span className="num">
                  {sourceLabel && <span className="update-source">{sourceLabel}</span>}
                  {downloadLabel && <span className="update-source">· 下载源 {downloadLabel}</span>}
                  {plan?.kind === 'single' && plan.asset.size > 0 ? ` · ${formatBytes(plan.asset.size)}` : ''}
                  {plan?.kind === 'parts' && plan.parts.length > 0
                    ? ` · ${plan.parts.length} 个分片`
                    : ''}
                </span>
              </div>
              {info?.publishedAt && (
                <div className="update-hint" style={{ padding: '8px 14px 0' }}>
                  发布于 {new Date(info.publishedAt).toLocaleString()}
                </div>
              )}
              <pre className="update-notes">{plainNotes(info?.notes || '（该版本没有填写说明）')}</pre>
            </div>
          )}

          {progress && installing && (
            <div className="update-progress">
              <div className="update-progress-bar" style={{ width: `${pct}%` }} />
              <span className="num">
                {pct}% · {formatBytes(progress.received)}
                {progress.total ? ` / ${formatBytes(progress.total)}` : ''}
              </span>
            </div>
          )}

          <div className="sheet-foot" style={{ padding: '13px 0 0', borderTop: 0 }}>
            <button
              type="button"
              className={`btn ${action.accent ? 'btn-accent' : 'btn-solid'}`}
              onClick={action.run}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          </div>

          {/* 发布源与 Token 只给需要改的人看：默认收起，普通用户看不到这些字段 */}
          <button
            type="button"
            className="update-adv-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? '收起高级设置 ▴' : '高级设置 ▾'}
          </button>

          {showAdvanced && (
            <div className="update-adv">
              <Row label="GitHub">
                <div className="field-box" style={{ display: 'flex', gap: 6, padding: '0 8px' }}>
                  <input
                    value={settings.update.owner}
                    onChange={(e) => patchSource('owner', e.target.value)}
                    aria-label="仓库所有者"
                    style={{ textAlign: 'left', padding: '8px 0', flex: 1, minWidth: 0 }}
                  />
                  <span style={{ color: 'var(--ink-3)', alignSelf: 'center', flex: 'none' }}>/</span>
                  <input
                    value={settings.update.repo}
                    onChange={(e) => patchSource('repo', e.target.value)}
                    aria-label="仓库名"
                    style={{ textAlign: 'left', padding: '8px 0', flex: 1, minWidth: 0 }}
                  />
                </div>
              </Row>
              <Row label="Token">
                <div className="field-box">
                  <input
                    type="password"
                    value={token}
                    placeholder="公开仓库留空"
                    onChange={(e) => setToken(e.target.value)}
                    aria-label="GitHub Token"
                    style={{ fontFamily: 'monospace', textAlign: 'left' }}
                  />
                </div>
              </Row>
              <p className="update-hint">
                默认先取 <code>{settings.update.owner}/{settings.update.repo}</code> 的最新 Release，公开仓库不需要 Token；
                GitHub 连不上时自动改用 Gitee 镜像 <code>{settings.update.giteeOwner}/{settings.update.giteeRepo}</code>。
                只有换发布源或仓库改为私有时才需要改这里；Token 存系统安全存储，不写入普通设置。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
