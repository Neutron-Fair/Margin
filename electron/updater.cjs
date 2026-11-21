const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawn } = require('node:child_process');

const UA = 'CoilBookCost-Updater';
const DEFAULT_OWNER = 'Neutron-Fair';
const DEFAULT_REPO = 'Margin';

/** 只接受来自 app://bundle 主框架的调用，与 secrets 桥同口径 */
function isTrusted(event) {
  try {
    const u = new URL(event.senderFrame.url);
    return u.protocol === 'app:' && u.hostname === 'bundle' && event.senderFrame === event.sender.mainFrame;
  } catch {
    return false;
  }
}

function assertTrusted(event) {
  if (!isTrusted(event)) throw new Error('不可信的更新请求');
}

/** 1.2.0 > 1.1.1；允许前缀 v 与预发布后缀（后缀只比较数字段，够用） */
function compareVersions(a, b) {
  const norm = (v) =>
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

function requestJson(url, token, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `token ${token}` } : {}),
        },
        timeout: 20000,
      },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects < 3) {
          res.resume();
          return resolve(requestJson(loc, token, redirects + 1));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* 非 JSON 响应交给上层按状态码处理 */
          }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, destPath, { token, onProgress, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: 'application/octet-stream',
          ...(token ? { Authorization: `token ${token}` } : {}),
        },
        timeout: 30000,
      },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects < 5) {
          res.resume();
          // 对象存储的签名直链自带凭据，继续带 token 会被拒绝
          return resolve(downloadFile(loc, destPath, { token: '', onProgress, redirects: redirects + 1 }));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`下载失败（HTTP ${res.statusCode}）`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (c) => {
          received += c.length;
          onProgress?.(received, total);
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve({ size: received, total })));
        out.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
    req.end();
  });
}

function registerUpdater() {
  ipcMain.handle('updater:current', async (event) => {
    assertTrusted(event);
    return { version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle('updater:check', async (event, opts = {}) => {
    assertTrusted(event);
    const owner = String(opts.owner || DEFAULT_OWNER).trim();
    const repo = String(opts.repo || DEFAULT_REPO).trim();
    const token = typeof opts.token === 'string' ? opts.token.trim() : '';
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return { ok: false, reason: 'bad-source' };

    const current = app.getVersion();
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const res = await requestJson(url, token);
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth', current };
    if (res.status === 404) return { ok: false, reason: 'not-found', current };
    if (res.status !== 200 || !res.json) return { ok: false, reason: `http-${res.status}`, current };

    const rel = res.json;
    const latest = String(rel.tag_name || '').replace(/^v/i, '');
    const assets = Array.isArray(rel.assets)
      ? rel.assets.map((a) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          apiUrl: a.url,
          downloadUrl: a.browser_download_url,
        }))
      : [];
    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      notes: rel.body || '',
      publishedAt: rel.published_at || '',
      assets,
    };
  });

  ipcMain.handle('updater:download', async (event, opts = {}) => {
    assertTrusted(event);
    const { apiUrl, name } = opts;
    const token = typeof opts.token === 'string' ? opts.token.trim() : '';
    if (typeof apiUrl !== 'string' || !/^https:\/\/api\.github\.com\//.test(apiUrl)) throw new Error('无效的下载地址');
    if (typeof name !== 'string' || !/^[\w.\- ]+\.(exe|zip)$/i.test(name)) throw new Error('无效的文件名');

    const dir = path.join(app.getPath('temp'), 'coilbook-update');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name.replace(/[^\w.\- ]+/g, '_'));

    const sender = event.sender;
    const result = await downloadFile(apiUrl, dest, {
      token,
      onProgress: (received, total) => {
        if (!sender.isDestroyed()) sender.send('updater:progress', { received, total });
      },
    });

    const stat = fs.statSync(dest);
    if (stat.size < 1024) throw new Error('下载的安装包不完整');
    return { ok: true, path: dest, size: stat.size, expected: result.total };
  });

  ipcMain.handle('updater:install', async (event, filePath) => {
    assertTrusted(event);
    if (typeof filePath !== 'string') throw new Error('无效的安装包路径');
    const resolved = path.resolve(filePath);
    const tempRoot = path.resolve(app.getPath('temp'));
    if (!resolved.startsWith(tempRoot + path.sep)) throw new Error('安装包不在临时目录内');
    if (!/\.exe$/i.test(resolved)) throw new Error('不是可执行的安装包');
    if (!fs.existsSync(resolved)) throw new Error('安装包不存在，请重新下载');

    /*
     * 升级必须走「先退出、再卸载、最后全新安装」。
     *
     * 实测（2026-11-21）：直接静默覆盖安装，NSIS 会在升级流程里把整个安装目录
     * 改名成 $PLUGINSDIR\old-install，本机必然 rename 失败并 Abort（退出码 2），
     * 装完版本号不变、文件时间戳不变 —— 等于什么也没装上。
     * 而「全新安装」和「先静默卸载再安装」都是退出码 0。
     *
     * 顺序：延时 3 秒让本进程彻底退出 → 静默卸载 → 等 6 秒 → 兜底清目录 → 静默安装。
     * 数据在 %APPDATA%\CoilBookCost（userData），卸载不会删，草稿与方案都还在。
     */
    const exeDir = path.dirname(process.execPath);
    const uninstaller = path.join(exeDir, 'Uninstall CoilBookCost.exe');
    const parts = ['timeout /t 3 /nobreak >nul'];
    if (fs.existsSync(uninstaller)) {
      parts.push(`"${uninstaller}" /S`);
      parts.push('timeout /t 6 /nobreak >nul');
      parts.push(`rmdir /s /q "${exeDir}"`);
      parts.push('timeout /t 1 /nobreak >nul');
    }
    parts.push(`"${resolved}" /S`);

    const child = spawn('cmd.exe', ['/c', parts.join(' & ')], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    setTimeout(() => app.exit(0), 300);
    return { ok: true };
  });
}

module.exports = { registerUpdater, compareVersions };
