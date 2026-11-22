/**
 * 真实 Electron 主进程验证「分片下载 → 拼接 → 校验」走新通道（net / 系统证书库）。
 * 1.2.4 的分片验证是走 node:https 的；1.2.5 把下载改成 net 优先，必须重测一遍。
 *
 * 用法：tools/probe-parts-download.ps1（真实 electron.exe 启动），结果写 PROBE_OUT。
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { _internals, mergeParts, sha256File } = require(path.join(__dirname, '..', 'electron', 'updater.cjs'));
const { requestJson, downloadFile } = _internals;

const OUT = process.env.PROBE_OUT || path.join(os.tmpdir(), 'coilbook-parts-probe.json');
const emit = (obj) => {
  try {
    fs.writeFileSync(OUT, JSON.stringify(obj, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
};

const API = 'https://gitee.com/api/v5/repos/neutronfair/Margin/releases/latest';

app.whenReady().then(async () => {
  const out = { electron: process.versions.electron };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-parts-probe-'));
  try {
    const rel = await requestJson(API, '');
    out.release = { status: rel.status, tag: rel.json && rel.json.tag_name };
    const assets = (rel.json && rel.json.assets) || [];

    const manifestAsset = assets.find((a) => /\.exe\.parts\.json$/i.test(a.name || ''));
    if (!manifestAsset) throw new Error('Relase 里没有 parts.json');
    const mp = path.join(dir, manifestAsset.name);
    await downloadFile(manifestAsset.browser_download_url, mp, { token: '' });
    const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
    out.manifest = { name: manifest.name, size: manifest.size, parts: manifest.parts.length };

    const t0 = Date.now();
    let bytes = 0;
    const files = [];
    for (const p of manifest.parts) {
      const asset = assets.find((a) => a.name === p.name);
      if (!asset) throw new Error('Release 里没有分片 ' + p.name);
      const dest = path.join(dir, p.name);
      const before = bytes;
      const got = await downloadFile(asset.browser_download_url, dest, {
        token: '',
        onProgress: (n) => {
          bytes = before + n;
        },
      });
      const st = fs.statSync(dest);
      if (st.size !== p.size) throw new Error(`${p.name} 大小不符 ${st.size} ≠ ${p.size}`);
      files.push(dest);
      out[`part${files.length}`] = { name: p.name, size: st.size, reported: got.size };
    }
    const dlMs = Date.now() - t0;

    const outFile = path.join(dir, manifest.name);
    const merged = await mergeParts(files, outFile, {
      expectedSize: manifest.size,
      expectedSha256: String(manifest.sha256).toLowerCase(),
    });
    out.merge = {
      path: merged.path.endsWith(manifest.name),
      size: merged.size,
      sizeMatches: merged.size === manifest.size,
      sha256: await sha256File(outFile),
      sha256Matches: (await sha256File(outFile)) === String(manifest.sha256).toLowerCase(),
      manifestSha256: String(manifest.sha256).toUpperCase(),
      downloadMs: dlMs,
      speedMBps: Number(((merged.size / 1024 / 1024) / (dlMs / 1000)).toFixed(2)),
    };
    out.ok = out.merge.sizeMatches && out.merge.sha256Matches;
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
}, 900000);
