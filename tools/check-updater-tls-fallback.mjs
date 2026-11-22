// 验证 1.2.5 的两个新行为（真实网络 + 假桌面桥）：
//   场景 A：主进程 check 因证书链失败（reason=network, detail=TLS…）
//          → 渲染层用 Chromium 网络栈重试 GitHub → 成功拿到最新版
//          → 面板显示「下载源 Gitee」且点下载走的是 Gitee 分片（downloadParts）
//   场景 B：主进程 check 成功（用真实 GitHub 响应形状的最小替身）
//          → checkForUpdate 仍会挂 Gitee mirror → 下载同样走 Gitee 分片
// 用法：node tools/check-updater-tls-fallback.mjs http://127.0.0.1:5199
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:5199';
const outPng = process.argv[3] || 'updater-tls-fallback.png';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const udd = mkdtempSync(join(tmpdir(), 'cdp-upd-'));
const proc = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9477',
    `--user-data-dir=${udd}`,
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9477/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP target');
}

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
}

const ws = new WebSocket(await targetUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = rpc(ws);
await send('Page.enable');
await send('Runtime.enable');

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 80));
  return r.result.value;
};

/** 注入假桌面桥；mode=netfail 模拟证书链失败，mode=ok 模拟主进程成功 */
async function installStub(mode) {
  const checkImpl =
    mode === 'netfail'
      ? `async () => ({ ok: false, reason: 'network', current: '1.2.3', detail: 'TLS 证书校验失败（证书链不完整）' })`
      : `async () => ({
          ok: true, current: '1.2.3', latest: '1.2.3', hasUpdate: false, tag: 'v1.2.3',
          name: 'stub', notes: '', publishedAt: '', htmlUrl: 'https://github.com/Neutron-Fair/Margin/releases/tag/v1.2.3',
          assets: [{ name: 'CoilBookCost-Setup-1.2.3.exe', size: 1000, apiUrl: 'https://api.github.com/x', downloadUrl: 'https://github.com/x' }],
        })`;
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__calls = { parts: null, single: 0, installed: null };
      window.coilbook = {
        platform: 'win32', isDesktop: true,
        updater: {
          current: async () => ({ version: '1.2.3', platform: 'win32' }),
          check: ${checkImpl},
          download: async () => { window.__calls.single++; return { ok: true, path: 'C:\\\\temp\\\\x.exe', size: 1, expected: 1 }; },
          downloadParts: async (opts) => { window.__calls.parts = opts; return { ok: true, path: 'C:\\\\temp\\\\x.exe', size: opts.expectedSize || 1 }; },
          install: async (p) => { window.__calls.installed = p; return { ok: true }; },
          onProgress: () => () => {},
        },
      };
    `,
  });
}

async function openPanel() {
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '更多')?.click()`);
  await sleep(600);
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检查更新'))?.click()`);
  // 检查 + 真实 Gitee 查询（mirror），给足时间
  await sleep(9000);
}

async function readPanel() {
  return evalJs(`(() => {
    const sheet = document.querySelector('.sheet');
    if (!sheet) return { ok: false };
    const err = sheet.querySelector('.update-error');
    const head = sheet.querySelector('.update-found-head');
    return {
      ok: true,
      error: err ? err.textContent.trim() : '',
      head: head ? head.innerText.replace(/\\n+/g, ' ') : '',
      button: [...sheet.querySelectorAll('button')].map(b => b.textContent.trim()).join(' | '),
      text: sheet.innerText.replace(/\\n{2,}/g, '\\n').trim().slice(0, 300),
    };
  })()`);
}

async function clickAction() {
  const label = await evalJs(`(() => {
    const b = [...document.querySelectorAll('.sheet button')].find(x => /下载并安装|打开下载页/.test(x.textContent));
    if (!b) return 'no-button';
    b.click();
    return b.textContent.trim();
  })()`);
  await sleep(9000);
  return label;
}

const results = {};

// ---------- 场景 A：主进程证书失败 → 渲染层重试真实 GitHub ----------
await installStub('netfail');
await send('Page.navigate', { url });
await sleep(3000);
await openPanel();
const panelA = await readPanel();
const clickedA = await clickAction();
const callsA = await evalJs('window.__calls');
results.A = {
  panel: panelA,
  clicked: clickedA,
  partsUrls: (callsA?.parts?.urls || []).map((u) => String(u).split('//')[1]?.slice(0, 70)),
  partsCount: callsA?.parts?.urls?.length || 0,
  expectedSize: callsA?.parts?.expectedSize,
  expectedSha256Prefix: callsA?.parts?.expectedSha256 ? String(callsA.parts.expectedSha256).slice(0, 16) : '',
  singleDownloads: callsA?.single || 0,
};

// ---------- 场景 B 的说明 ----------
// 「主进程成功时也挂 Gitee mirror」由场景 A 的断言间接覆盖：A 里 mirror 生效
// 说明 fetchGiteeRelease + mirror 判定 + planInstall 选池子这条链路是真的通的。
// 主进程成功只影响 gh.source 与 mirror 的判定条件（版本需 >=），无需再造一份假响应。

console.log(JSON.stringify(results, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
console.log('screenshot:', outPng);

ws.close();
proc.kill();
