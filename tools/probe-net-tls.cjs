/**
 * 诊断：对比 Electron 主进程里两条请求路径对「证书链不完整」网站的差异。
 * 1) node:https  → Node 内置 CA bundle（当前线上报 unable to verify the first certificate）
 * 2) electron.net → Chromium 网络栈（走 Windows 系统证书库）
 *
 * 用法：由 tools/probe-net-tls.ps1 以真实 electron.exe 启动，不要在 node 下直接跑。
 */
const { app, net } = require('electron');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

// Electron 是 GUI 子系统进程，stdout 不落到控制台，结果一律写文件
const OUT = process.env.PROBE_OUT || path.join(process.env.TEMP || '.', 'coilbook-probe-net.json');
const emit = (obj) => {
  const text = JSON.stringify(obj, null, 2);
  try {
    fs.writeFileSync(OUT, text, 'utf8');
  } catch {
    /* ignore */
  }
  console.log('PROBE ' + JSON.stringify(obj));
};

const URL_GH = 'https://api.github.com/repos/Neutron-Fair/Margin/releases/latest';

function viaHttps(url) {
  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: 'GET', headers: { 'User-Agent': 'coilbook-probe', Accept: 'application/vnd.github+json' }, timeout: 20000 },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ via: 'node:https', status: res.statusCode }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ via: 'node:https', error: String((e && e.message) || e) }));
    req.end();
  });
}

function viaNet(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const req = net.request({ url, method: 'GET', redirect: 'follow' });
    req.setHeader('User-Agent', 'coilbook-probe');
    req.setHeader('Accept', 'application/vnd.github+json');
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        done({ via: 'electron.net', status: res.statusCode, bytes: Buffer.concat(chunks).length }),
      );
      res.on('error', (e) => done({ via: 'electron.net', error: String((e && e.message) || e) }));
    });
    req.on('error', (e) => done({ via: 'electron.net', error: String((e && e.message) || e) }));
    req.end();
  });
}

app.whenReady().then(async () => {
  const out = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome };
  try {
    out.https = await viaHttps(URL_GH);
    out.net = await viaNet(URL_GH);
  } catch (e) {
    out.fatal = String((e && e.message) || e);
  }
  emit(out);
  app.exit(0);
});

setTimeout(() => {
  emit({ timeout: true });
  app.exit(2);
}, 45000);
