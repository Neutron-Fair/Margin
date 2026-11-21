// 用 CDP 精确控制视口截图（比 --window-size 可靠：窗口尺寸在 headless 下会受 DPR 影响）
// 用法：
//   node tools/shot-cdp.mjs --url http://127.0.0.1:5299 --out out.png [--w 390] [--h 844] [--dpr 2]
//        [--eval "document.querySelector('.dock-tab:nth-child(2)').click()"] [--wait 400] [--measure]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(`--${k}`);

const url = arg('url', 'http://127.0.0.1:5299');
const out = arg('out', 'shot.png');
const W = Number(arg('w', '390'));
const H = Number(arg('h', '844'));
const DPR = Number(arg('dpr', '2'));
const evalJs = arg('eval', '');
const waitMs = Number(arg('wait', '500'));
const measure = flag('measure');
const port = Number(arg('port', '9333'));
const edge = arg(
  'edge',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
);

const profile = mkdtempSync(join(tmpdir(), 'cdp-shot-'));
const proc = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(120);
  }
  throw new Error('CDP target 不可用');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params }));
          return new Promise((res, rej) => pending.set(mid, { res, rej }));
        },
        on(event, fn) {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event).push(fn);
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result);
        return;
      }
      if (msg.method && listeners.has(msg.method)) {
        for (const fn of listeners.get(msg.method)) fn(msg.params);
      }
    });
  });
}

const MEASURE_JS = `(() => {
  const de = document.documentElement;
  const out = { innerWidth: innerWidth, innerHeight: innerHeight, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, dpr: devicePixelRatio, offenders: [] };
  if (de.scrollWidth > de.clientWidth + 1) {
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (r.right > de.clientWidth + 1) {
        out.offenders.push(((el.className || el.tagName).toString().slice(0, 30)) + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
        if (out.offenders.length > 12) break;
      }
    }
  }
  return out;
})()`;

const ws = await connect(await getTarget());
await ws.send('Page.enable');
await ws.send('Runtime.enable');
await ws.send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: DPR,
  mobile: false,
});

const loaded = new Promise((r) => ws.on('Page.loadEventFired', r));
await ws.send('Page.navigate', { url });
await Promise.race([loaded, sleep(8000)]);
await sleep(waitMs);

if (evalJs) {
  const r = await ws.send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) console.log('EVAL ERROR:', r.exceptionDetails.text);
  else if (r.result?.value !== undefined) console.log('EVAL:', JSON.stringify(r.result.value));
  await sleep(waitMs);
}

if (measure) {
  const r = await ws.send('Runtime.evaluate', { expression: MEASURE_JS, returnByValue: true });
  console.log('MEASURE:', JSON.stringify(r.result.value, null, 1));
}

const shot = await ws.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`shot: ${out} (${W}x${H} @${DPR}x)`);

ws.close();
proc.kill();
