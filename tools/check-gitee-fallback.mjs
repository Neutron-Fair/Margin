// 验证「GitHub 挂了 → 退回 Gitee → 识别分片 → 调用分片下载」这条链路
// 做法：注入一个假的桌面 updater（check 固定失败、downloadParts 只记录参数），
//       Gitee 的请求走真实网络（仓库里已经发布了 v1.2.3 的 APK + 两个分片）。
// 用法：node tools/check-gitee-fallback.mjs http://127.0.0.1:5399 out.png
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:5399';
const outPng = process.argv[3] || 'gitee-fallback.png';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const udd = mkdtempSync(join(tmpdir(), 'cdp-gitee-'));
const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9466',
  `--user-data-dir=${udd}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9466/json/list')).json();
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
  return (method, params = {}) => new Promise((resolve, reject) => {
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

// 假桌面：check 永远 network 失败（模拟 GitHub 连不上），其余只记录
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__calls = { parts: null, installed: null, downloads: 0 };
    window.coilbook = {
      platform: 'win32',
      isDesktop: true,
      updater: {
        current: async () => ({ version: '1.2.2', platform: 'win32' }),
        check: async () => ({ ok: false, reason: 'network', current: '1.2.2' }),
        download: async () => { window.__calls.downloads++; return { ok: true, path: 'C:\\\\temp\\\\fake.exe', size: 1, expected: 1 }; },
        downloadParts: async (opts) => {
          window.__calls.parts = opts;
          return { ok: true, path: 'C:\\\\temp\\\\fake.exe', size: opts.expectedSize || 1 };
        },
        install: async (p) => { window.__calls.installed = p; return { ok: true }; },
        onProgress: () => () => {},
      },
    };
  `,
});

await send('Page.navigate', { url });
await sleep(2500);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 60));
  return r.result.value;
};

await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '更多')?.click()`);
await sleep(700);
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检查更新'))?.click()`);
await sleep(6000);

const panel = await evalJs(`(() => {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return { ok: false };
  return {
    ok: true,
    text: sheet.innerText.replace(/\\n{2,}/g, '\\n').trim(),
    buttons: [...sheet.querySelectorAll('button')].map(b => b.textContent.trim()),
    hasAdvancedOpen: Boolean(sheet.querySelector('input[aria-label="GitHub Token"]')),
  };
})()`);
console.log('=== 面板 ===');
console.log(panel.text);

// 点主按钮，验证走的是分片下载
const clicked = await evalJs(`(() => {
  const b = [...document.querySelectorAll('.sheet button')].find(x => /下载并安装|打开下载页/.test(x.textContent));
  if (!b) return 'no-button';
  b.click();
  return b.textContent.trim();
})()`);
await sleep(8000);

const calls = await evalJs(`window.__calls`);
const chips = await evalJs(`(() => { const s=document.querySelector('.sheet'); return s ? s.innerText.replace(/\\n{2,}/g,'\\n').trim() : ''; })()`);

console.log('=== 点击的按钮 ===');
console.log(clicked);
console.log('=== 下载调用 ===');
console.log(JSON.stringify({
  urls: calls?.parts?.urls?.length,
  urlsSample: calls?.parts?.urls?.map((u) => String(u).split('//')[1]?.slice(0, 60)),
  name: calls?.parts?.name,
  expectedSize: calls?.parts?.expectedSize,
  expectedSha256: calls?.parts?.expectedSha256?.slice(0, 16) + '…',
  installed: calls?.installed,
  singleDownloads: calls?.downloads,
}, null, 2));
console.log('=== 点后面板 ===');
console.log(chips.slice(0, 400));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
console.log('screenshot:', outPng);

ws.close();
proc.kill();
