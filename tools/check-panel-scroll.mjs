// 验证两件事：①桌面端「更多」入口是否存在；②面板打开后滚轮不会带动主界面
// 用法：node tools/check-panel-scroll.mjs http://127.0.0.1:5399
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:5399';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const udd = mkdtempSync(join(tmpdir(), 'cdp-scroll-'));
const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9444',
  `--user-data-dir=${udd}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9444/json/list')).json();
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

const wsUrl = await targetUrl();
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = rpc(ws);
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(2500);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 80));
  return r.result.value;
};

const out = {};
out.headerButtons = await evalJs(`[...document.querySelectorAll('.header-actions button')].map(b => b.textContent.trim())`);
out.hasMoreEntry = out.headerButtons.includes('更多');

// 压小视口并先让主界面真的滚起来，否则「没被滚动」可能只是内容不够高
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 560, deviceScaleFactor: 1, mobile: false });
await sleep(400);
out.pageScrollable = await evalJs(`document.documentElement.scrollHeight > window.innerHeight`);
await evalJs(`window.scrollTo(0, 420)`);
await sleep(300);
out.mainScrollBefore = await evalJs(`({ win: window.scrollY, body: document.body.scrollTop, doc: document.documentElement.scrollTop })`);

// 打开设置面板
await evalJs(`[...document.querySelectorAll('.header-actions button')].find(b => b.textContent.trim() === '设置')?.click()`);
await sleep(600);
out.panelState = await evalJs(`document.body.dataset.panelState`);
out.bodyOverflow = await evalJs(`getComputedStyle(document.body).overflow`);
out.sheetOverflow = await evalJs(`(() => { const el = document.querySelector('.sheet-body'); return el ? { overflowY: getComputedStyle(el).overflowY, overscroll: getComputedStyle(el).overscrollBehaviorY, h: el.clientHeight, sh: el.scrollHeight } : null; })()`);

// 在面板上狂滚滚轮
const box = await evalJs(`(() => { const el = document.querySelector('.sheet-body'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
for (let i = 0; i < 30; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 260,
    pointerType: 'mouse', clickCount: 0,
  });
  await sleep(35);
}
await sleep(400);
out.mainScrollAfter = await evalJs(`({ win: window.scrollY, body: document.body.scrollTop, doc: document.documentElement.scrollTop })`);
out.sheetScrollTop = await evalJs(`document.querySelector('.sheet-body')?.scrollTop ?? -1`);

// 面板滚到底之后继续滚，主界面仍不能动
await evalJs(`(() => { const el = document.querySelector('.sheet-body'); el.scrollTop = el.scrollHeight; })()`);
await sleep(200);
for (let i = 0; i < 15; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 300,
    pointerType: 'mouse', clickCount: 0,
  });
  await sleep(35);
}
await sleep(300);
out.mainScrollAtPanelBottom = await evalJs(`window.scrollY`);

// 关闭面板：主界面位置应原样保留、滚动恢复可用
await evalJs(`document.querySelector('.overlay')?.click()`);
await sleep(600);
out.panelClosed = await evalJs(`document.body.dataset.panelState`);
out.bodyOverflowAfterClose = await evalJs(`getComputedStyle(document.body).overflow`);
out.mainScrollAfterClose = await evalJs(`window.scrollY`);
out.mainScrollableAfterClose = await evalJs(`document.documentElement.scrollHeight > window.innerHeight`);

const before = out.mainScrollBefore.win + out.mainScrollBefore.doc + out.mainScrollBefore.body;
const after = out.mainScrollAfter.win + out.mainScrollAfter.doc + out.mainScrollAfter.body;
out.mainScrollFrozen = before === after;

console.log(JSON.stringify(out, null, 2));
console.log(out.pageScrollable ? 'PASS 主界面原本可滚（测试有效）' : 'FAIL 主界面不可滚，测试无效');
console.log(out.hasMoreEntry ? 'PASS 桌面有「更多」入口' : 'FAIL 桌面仍无「更多」入口');
console.log(out.mainScrollFrozen ? `PASS 面板打开时主界面未滚动（停在 ${before}）` : `FAIL 主界面被滚动穿透 ${before} -> ${after}`);
console.log(out.sheetScrollTop > 0 ? 'PASS 面板自身正常滚动' : 'WARN 面板自身没滚动（内容不足一屏）');
console.log(out.mainScrollAtPanelBottom === 420 ? 'PASS 面板滚到底后主界面仍冻结' : `FAIL 面板滚到底后主界面被带动（${out.mainScrollAtPanelBottom}）`);
console.log(out.bodyOverflowAfterClose !== 'hidden' ? 'PASS 关闭后滚动解锁' : 'FAIL 关闭后仍被锁');
console.log(out.mainScrollAfterClose > 0 ? `PASS 关闭后位置保留（${out.mainScrollAfterClose}）` : 'WARN 关闭后回到顶部');
ws.close();
proc.kill();
