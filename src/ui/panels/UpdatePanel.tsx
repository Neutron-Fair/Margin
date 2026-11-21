import { useEffect, useState } from 'react';
import { getUpdateToken, setUpdateToken } from '../../store/secrets.ts';
import { loadSettings, saveSettings, type Settings } from '../../store/storage.ts';
import {
  checkForUpdate,
  currentVersion,
  downloadUpdate,
  formatBytes,
  installUpdate,
  isAndroid,
  isDesktop,
  openDownload,
  pickAsset,
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

/** 把 GitHub Release 的 Markdown 粗略压成纯文本，够看清改了什么即可 */
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

  useEffect(() => {
    let active = true;
    (async () => {
      setVersion(await currentVersion());
      try {
        const t = await getUpdateToken();
        if (active) setToken(t);
      } catch {
        /* 安全存储不可用时只是不能存 token，不影响公开仓库检查 */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
      const res = await checkForUpdate(settings.update, token);
      if (!res.ok) {
        const map: Record<string, string> = {
          auth: '凭据被拒绝：请在下方填一个有 repo 只读权限的 GitHub Token',
          'not-found': '找不到该仓库的 Release：仓库可能是私有的（需填 Token），或还没有发布版本',
          'bad-source': '仓库名不合法',
          network: '网络不可达，检查代理或网络后重试',
        };
        setError(map[res.reason || ''] || `检查失败（${res.reason || '未知原因'}）`);
      } else {
        setInfo(res);
        if (!res.hasUpdate) onToast(`已是最新版本 ${res.current}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  const asset: UpdateAsset | undefined = info?.assets ? pickAsset(info.assets) : undefined;

  const doInstall = async () => {
    if (!asset) return;
    setError('');
    setInstalling(true);
    try {
      if (isDesktop()) {
        setProgress({ received: 0, total: asset.size });
        const file = await downloadUpdate(asset, token, (p) => setProgress(p));
        onToast(`安装包已下载（${formatBytes(file.size)}），2 秒后开始安装`);
        await installUpdate(file.path);
      } else if (isAndroid()) {
        openDownload(asset.downloadUrl);
        onToast('已交给系统浏览器下载，下载完成后点开安装即可');
      } else {
        openDownload(asset.downloadUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载或安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;

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
          <Row label="仓库">
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
                placeholder="公开仓库可留空"
                onChange={(e) => setToken(e.target.value)}
                aria-label="GitHub Token"
                style={{ fontFamily: 'monospace', textAlign: 'left' }}
              />
            </div>
          </Row>
          <p className="update-hint">
            仓库私有时需要填一个只读 Token（<code>repo</code> 权限）。Token 存系统安全存储，不写入普通设置。
          </p>

          {error && <div className="update-error">{error}</div>}

          {info?.ok && info.hasUpdate && (
            <div className="update-found">
              <div className="update-found-head">
                <b className="num">v{info.latest}</b>
                {asset && <span className="num">{formatBytes(asset.size)}</span>}
              </div>
              {info.publishedAt && (
                <div className="update-hint">发布于 {new Date(info.publishedAt).toLocaleString()}</div>
              )}
              <pre className="update-notes">{plainNotes(info.notes || '（该版本没有填写说明）')}</pre>
              {!asset && <div className="update-error">该版本没有提供当前平台可用的安装包</div>}
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
            <button type="button" className="btn" onClick={onClose}>
              关闭
            </button>
            {info?.ok && info.hasUpdate && asset ? (
              <button type="button" className="btn btn-accent" onClick={doInstall} disabled={installing}>
                {installing ? '处理中…' : isDesktop() ? '下载并安装' : '打开下载页'}
              </button>
            ) : (
              <button type="button" className="btn btn-solid" onClick={doCheck} disabled={checking}>
                {checking ? '检查中…' : '检查更新'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
