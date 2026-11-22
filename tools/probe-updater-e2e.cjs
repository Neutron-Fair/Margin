/**
 * 端到端验证更新链路（真实 Electron 主进程，不是 mock）：
 *   1) 查 GitHub latest Release —— 证书链不全的机器上 node:https 会失败、net 应成功
 *   2) downloadFile 下载 GitHub EXE 的前 4MB（Range，避免 149MB 慢速等待）——验证流式写盘
 *   3) downloadFile 下载 Gitee 的 parts.json（小文件）——验证跨源下载
 *   4) 顺带核对 GitHub asset 的 size / digest 字段
 *
 * 用法：tools/probe-updater-e2e.ps1 以真实 electron.exe 启动；结果写 PROBE_OUT。
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const { _internals, sha256File } = require(path.join(__dirname, '..', 'electron', 'updater.cjs'));
const { requestJson, downloadFile, electronNet } = _internals;

const OUT = process.env.PROBE_OUT || path.join(os.tmpdir(), 'coilbook-updater-e2e.json');
const emit = (obj) => {
  try {
    fs.writeFileSync(OUT, JSON.stringify(obj, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
};

const GH = 'https://api.github.com/repos/Neutron-Fair/Margin/releases/latest';
const GT = 'https://gitee.com/api/v5/repos/neutronfair/Margin/releases/latest';

/** 带 Range 的流式下载，验证 net 对大文件响应的处理（不下载整包） */
function rangeDownload(url, dest, bytes) {
  return new Promise((resolve, reject) => {
    const n = electronNet();
    if (!n) return reject(new Error('electron.net 不可用'));
    let req;
    try {
      req = n.request({ url, method: 'GET', redirect: 'follow' });
    } catch (e) {
      return reject(e);
    }
    req.setHeader('User-Agent', 'CoilBookCost-Updater');
    // 不带它 api.github.com/repos/.../assets/{id} 会回 JSON 元数据而不是重定向到文件
    req.setHeader('Accept', 'application/octet-stream');
    req.setHeader('Range', `bytes=0-${bytes - 1}`);
    let received = 0;
    req.on('response', (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => {
        received += c.length;
      });
      res.on('error', reject);
      out.on('error', reject);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ status: res.statusCode, size: received })));
    });
    req.on('error', reject);
    req.end();
  });
}

app.whenReady().then(async () => {
  const out = {
    electron: process.versions.electron,
    node: process.versions.node,
    netAvailable: Boolean(electronNet()),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-e2e-'));
  try {
    // 1) GitHub latest（证书链考验点）
    const t0 = Date.now();
    const gh = await requestJson(GH, '');
    out.githubCheck = { status: gh.status, ms: Date.now() - t0, tag: gh.json && gh.json.tag_name };
    if (gh.status !== 200 || !gh.json) throw new Error('GitHub check 失败 ' + gh.status);

    const exe = (gh.json.assets || []).find((a) => /\.exe$/i.test(a.name || ''));
    if (!exe) throw new Error('GitHub Release 没有 EXE');
    out.asset = { name: exe.name, size: exe.size, hasDigest: Boolean(exe.digest) };

    // 2) Range 下载前 4MB（走 net → 系统证书库，且验证 302 到对象存储）
    const exePath = path.join(dir, 'head.bin');
    const t1 = Date.now();
    const head = await rangeDownload(exe.url, exePath, 4 * 1024 * 1024);
    out.rangeDownload = { ms: Date.now() - t1, ...head };
    fs.rmSync(exePath, { force: true });

    // 3) Gitee 小文件下载（走 downloadFile，验证跨源与写盘）
    const gt = await requestJson(GT, '');
    out.giteeCheck = { status: gt.status, tag: gt.json && gt.json.tag_name };
    const manifest = (gt.json?.assets || []).find((a) => /\.parts\.json$/i.test(a.name || ''));
    if (manifest) {
      const p = path.join(dir, manifest.name);
      const g = await downloadFile(manifest.browser_download_url, p, { token: '' });
      const text = fs.readFileSync(p, 'utf8');
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* ignore */
      }
      out.giteeDownload = {
        name: manifest.name,
        size: g.size,
        sha256: await sha256File(p),
        manifestSize: parsed && parsed.size,
        manifestSha256: parsed && parsed.sha256,
      };
      fs.rmSync(p, { force: true });
    }

    // 4) 对照：node:https 在同样地址是否仍失败（证明修复的是"通道"而不是"关校验"）
    out.httpsControl = await new Promise((resolve) => {
      const req = https.request(
        GH,
        { method: 'GET', headers: { 'User-Agent': 'probe', Accept: 'application/vnd.github+json' }, timeout: 15000 },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ error: String(e.message) }));
      req.end();
    });

    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.message) || e);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    emit(out);
    app.exit(out.ok ? 0 : 1);
  }
});

setTimeout(() => {
  emit({ ok: false, error: 'probe timeout' });
  app.exit(2);
}, 180000);
