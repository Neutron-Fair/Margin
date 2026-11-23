// 验证「删掉一个东西」的两种操作在界面上的真实表现：
//   A. 把「每本张数」清空  → 应暂停报价并提示（不是静默按旧值算）
//   B. 把「每本张数」填 0  → 该模块整块不计（上机费/备损费也归零）
//   C. 改回 1            → 回到默认报价
// 用法：node tools/check-delete-behavior.mjs http://127.0.0.1:5199
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:5199';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const udd = mkdtempSync(join(tmpdir(), 'cdp-del-'));
const proc = spawn(
  edge,
  ['--headless=new', '--disable-gpu', '--remote-debugging-port=9488', `--user-data-dir=${udd}`, '--window-size=1400,900', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9488/json/list')).json();
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

await send('Page.navigate', { url });
await sleep(2500);

// 关掉可能挡住点击的引导/弹窗，并展开衬纸模块
await evalJs(`(() => {
  document.querySelectorAll('.overlay .icon-btn').forEach(b => b.click());
  const head = document.querySelector('#module-liner .module-head');
  if (head && head.getAttribute('aria-expanded') !== 'true') head.click();
  return true;
})()`);
await sleep(500);

const readState = () =>
  evalJs(`(() => {
    const hero = document.querySelector('.result-amount');
    const alert = document.querySelector('[role="alert"]');
    const linerCost = document.querySelector('#module-liner .per-book');
    return {
      unit: hero ? hero.textContent.replace(/\\s+/g, '') : null,
      blocked: Boolean(alert),
      alertText: alert ? alert.textContent.replace(/\\s+/g, ' ').slice(0, 120) : '',
      linerSummary: linerCost ? linerCost.textContent.trim() : null,
      total: (document.querySelector('.result-duo .value.num') || {}).textContent || null,
    };
  })()`);

const setSheets = (v) =>
  evalJs(`(() => {
    const el = document.querySelector('#module-liner input[aria-label="每本张数"]');
    if (!el) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);

const out = {};
out.baseline = await readState();

// A. 清空
await setSheets('');
await sleep(600);
out.cleared = await readState();

// B. 填 0
await setSheets('0');
await sleep(600);
out.zeroed = await readState();

// C. 恢复 1
await setSheets('1');
await sleep(600);
out.restored = await readState();

console.log(JSON.stringify(out, null, 2));
ws.close();
proc.kill();
