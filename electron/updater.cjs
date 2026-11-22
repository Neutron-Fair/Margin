const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
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

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
    rs.on('error', reject);
  });
}

/**
 * 把若干分片按顺序拼成一个文件，并按期望大小/哈希校验。
 * 抽成独立函数便于单测（拼接与校验是这条链路最容易出错的地方）。
 */
async function mergeParts(partPaths, outPath, { expectedSize = 0, expectedSha256 = '' } = {}) {
  fs.rmSync(outPath, { force: true });
  const ws = fs.createWriteStream(outPath);
  try {
    for (const p of partPaths) {
      await pipeline(fs.createReadStream(p), ws, { end: false });
    }
  } finally {
    await new Promise((resolve) => ws.end(resolve));
  }

  const st = fs.statSync(outPath);
  if (expectedSize > 0 && st.size !== expectedSize) {
    fs.rmSync(outPath, { force: true });
    throw new Error(`合并后大小不符（${st.size} ≠ ${expectedSize}），请重试`);
  }
  if (st.size < 1024) {
    fs.rmSync(outPath, { force: true });
    throw new Error('合并后的安装包不完整');
  }
  if (/^[a-f0-9]{64}$/.test(expectedSha256)) {
    const actual = await sha256File(outPath);
    if (actual !== expectedSha256) {
      fs.rmSync(outPath, { force: true });
      throw new Error('安装包校验失败（SHA-256 不一致），请重试');
    }
  }
  return { ok: true, path: outPath, size: st.size };
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
      htmlUrl: rel.html_url || '',
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

  /*
   * 分片下载（Gitee 的产物）：GitHub Release 的单附件没有大小限制，
   * 而 Gitee 发行版附件单文件上限 100MB，所以 142MB 的安装包在那里被切成
   * `<名称>.exe.part1/.part2`。这里按顺序下载、拼接、按清单校验后返回路径。
   */
  ipcMain.handle('updater:download-parts', async (event, opts = {}) => {
    assertTrusted(event);
    const urls = Array.isArray(opts.urls) ? opts.urls : [];
    const name = typeof opts.name === 'string' ? opts.name : '';
    const expectedSize = Number(opts.expectedSize) || 0;
    const expectedSha256 = typeof opts.expectedSha256 === 'string' ? opts.expectedSha256.trim().toLowerCase() : '';

    if (urls.length === 0 || urls.length > 8) throw new Error('无效的分片列表');
    for (const u of urls) {
      if (
        typeof u !== 'string' ||
        !/^https:\/\/(gitee\.com|github\.com|api\.github\.com|objects\.githubusercontent\.com)\//.test(u)
      ) {
        throw new Error('无效的下载地址');
      }
    }
    if (!/^[\w.\- ]+\.exe$/i.test(name)) throw new Error('无效的文件名');

    const dir = path.join(app.getPath('temp'), 'coilbook-update');
    fs.mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^\w.\- ]+/g, '_');
    const sender = event.sender;
    const total = expectedSize > 0 ? expectedSize : 0;
    let received = 0;
    const partPaths = [];

    for (let i = 0; i < urls.length; i += 1) {
      const dest = path.join(dir, `${safe}.part${i + 1}`);
      const base = received;
      await downloadFile(urls[i], dest, {
        token: '',
        onProgress: (n) => {
          if (!sender.isDestroyed()) sender.send('updater:progress', { received: base + n, total });
        },
      });
      const st = fs.statSync(dest);
      if (st.size < 1024) throw new Error(`第 ${i + 1} 个分片下载不完整`);
      received = base + st.size;
      partPaths.push(dest);
    }

    const out = path.join(dir, safe);
    const merged = await mergeParts(partPaths, out, { expectedSize: total, expectedSha256 });
    for (const p of partPaths) fs.rmSync(p, { force: true });
    return merged;
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

module.exports = { registerUpdater, compareVersions, mergeParts, sha256File };
