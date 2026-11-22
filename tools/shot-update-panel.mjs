// 打开「更多 → 检查更新」，等自动检查完成后截图并 dump 面板文本
// 用法：node tools/shot-update-panel.mjs http://127.0.0.1:5399 out.png
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:5399';
const outPng = process.argv[3] || 'update-panel.png';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const udd = mkdtempSync(join(tmpdir(), 'cdp-upd-'));
const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9455',
  `--user-data-dir=${udd}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9455/json/list')).json();
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

// --fake：伪造一个更高版本的 Release，用来验「有更新」时也是只留一个按钮
const fake = process.argv.includes('--fake');
if (fake) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      const realFetch = window.fetch;
      window.fetch = (input, init) => {
        const u = typeof input === 'string' ? input : (input && input.url) || '';
        if (u.includes('/releases/latest')) {
          const body = JSON.stringify({
            tag_name: 'v9.9.9', name: 'v9.9.9 测试版',
            published_at: '2026-11-22T02:00:00Z',
            html_url: 'https://github.com/Neutron-Fair/Margin/releases/tag/v9.9.9',
            body: '## 测试更新\\n\\n- 第一项改动\\n- 第二项改动',
            assets: [
              { id: 1, name: 'CoilBookCost-Setup-9.9.9.exe', size: 149000000, url: 'https://api.example/a', browser_download_url: 'https://example.com/a.exe' },
              { id: 2, name: 'CoilBookCost-9.9.9.apk', size: 8000000, url: 'https://api.example/b', browser_download_url: 'https://example.com/a.apk' }
            ]
          });
          return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return realFetch(input, init);
      };
    `,
  });
}

await send('Page.navigate', { url });
await sleep(2500);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

// 更多 → 检查更新
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '更多')?.click()`);
await sleep(700);
const opened = await evalJs(`Boolean([...document.querySelectorAll('button')].find(b => b.textContent.includes('检查更新')))`);
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('检查更新'))?.click()`);
// 等自动检查（GitHub API）
await sleep(5000);

const report = await evalJs(`(() => {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return { ok: false, why: 'no sheet' };
  const buttons = [...sheet.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), cls: b.className, disabled: b.disabled }));
  return {
    ok: true,
    buttons,
    text: sheet.innerText.replace(/\\n{2,}/g, '\\n').trim(),
    hasRepoField: Boolean(sheet.querySelector('input[aria-label="仓库所有者"]')),
    hasTokenField: Boolean(sheet.querySelector('input[aria-label="GitHub Token"]')),
  };
})()`);

console.log('入口可点:', opened);
console.log(JSON.stringify(report, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
console.log('screenshot:', outPng);
ws.close();
proc.kill();
