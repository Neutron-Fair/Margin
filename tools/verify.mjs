/**
 * 一键验收：类型检查 → 单测 → 构建 → 桌面/手机画幅探针 →（可选）离线 OCR
 *
 *   node tools/verify.mjs           # 快速验收（约 15 秒）
 *   node tools/verify.mjs --ocr     # 含离线 OCR 实证（约 1 分钟）
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BASE_PORT = Number(process.env.VERIFY_PORT || 5299);
const CANDIDATE_PORTS = [BASE_PORT, BASE_PORT + 1, BASE_PORT + 2, BASE_PORT + 3, BASE_PORT + 4];
let BASE = `http://127.0.0.1:${BASE_PORT}`;
const WITH_OCR = process.argv.includes('--ocr');

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findEdge = () => EDGE_CANDIDATES.find((p) => fs.existsSync(p));

function run(cmd, args, label) {
  process.stdout.write(`\n▸ ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
  const ok = (r.status ?? 1) === 0;
  console.log(ok ? `  ✓ ${label}` : `  ✗ ${label} (exit ${r.status}${r.error ? ' / ' + r.error.code : ''})`);
  return ok;
}

/** 直接调用本地二进制，避开 Windows 上 npm.cmd 需要 shell 的坑 */
const nodeBin = (p) => path.join(root, 'node_modules', p);

async function waitPort(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/index.html`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  return false;
}

/** 依次尝试候选端口，返回可用服务 */
async function startServer() {
  for (const port of CANDIDATE_PORTS) {
    const base = `http://127.0.0.1:${port}`;
    const child = spawn('node', [path.join(__dirname, 'serve.mjs')], {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, PORT: String(port) },
    });
    let exited = false;
    child.on('exit', () => {
      exited = true;
    });
    const deadline = Date.now() + 5000;
    let up = false;
    while (Date.now() < deadline) {
      if (exited) break;
      try {
        const res = await fetch(`${base}/index.html`);
        if (res.ok) {
          up = true;
          break;
        }
      } catch {
        /* retry */
      }
      await sleep(250);
    }
    if (up) {
      BASE = base;
      return child;
    }
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function runProbe(edge, suite, winW, winH, timeoutMs, extraArgs = [], opts = {}) {
  const reportFile = path.join(__dirname, `probe-report-${suite}.json`);
  try {
    fs.unlinkSync(reportFile);
  } catch {
    /* none */
  }
  const userDir = path.join(process.env.TEMP || '/tmp', `cbc-verify-${suite}-${Date.now()}`);
  const args = ['--headless', '--disable-gpu', '--no-sandbox', `--window-size=${winW},${winH}`];
  // 虚拟时间会提前退出浏览器，只适用于「加载完就能出结果」的探针；
  // OCR 涉及 wasm 编译与 worker，必须走真实时间
  if (opts.virtualTime !== false) args.push('--virtual-time-budget=9000');
  args.push(`--user-data-dir=${userDir}`, ...extraArgs, `${BASE}/__probe.html?suite=${suite}`);
  const child = spawn(edge, args, { stdio: 'ignore' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(reportFile)) {
      await sleep(300);
      break;
    }
    await sleep(400);
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(userDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  if (!fs.existsSync(reportFile)) {
    return {
      suite,
      items: [{ name: `${suite}.timeout`, pass: false, detail: `no report in ${timeoutMs}ms` }],
    };
  }
  return { suite, items: JSON.parse(fs.readFileSync(reportFile, 'utf8')) };
}

function printProbe(result) {
  const pass = result.items.filter((i) => i.pass).length;
  const fail = result.items.length - pass;
  console.log(`\n▸ 探针 ${result.suite}  (PASS=${pass} FAIL=${fail})`);
  for (const i of result.items) {
    console.log(`  ${i.pass ? '✓' : '✗'} ${i.name}${i.detail ? '  — ' + i.detail : ''}`);
  }
  return { pass, fail };
}

(async () => {
  const started = Date.now();
  const steps = [];

  steps.push(['类型检查', run('node', [nodeBin('typescript/bin/tsc'), '--noEmit'], 'tsc --noEmit')]);
  steps.push(['单元测试', run('node', ['--test'], 'node --test')]);
  steps.push(['生产构建', run('node', [nodeBin('vite/bin/vite.js'), 'build'], 'vite build')]);

  const edge = findEdge();
  if (!edge) {
    console.error('\n找不到 Edge/Chrome，跳过画幅探针');
  }

  let server = null;
  let probeFails = 0;
  if (edge) {
    server = await startServer();
    if (!server) {
      console.error('\n静态服务启动失败（候选端口均被占用）');
      probeFails += 1;
    } else {
      console.log(`\n▸ 静态服务 ${BASE}`);
      const desktop = await runProbe(edge, 'desktop', 1440, 900, 30000);
      const r1 = printProbe(desktop);
      probeFails += r1.fail;

      const mobile = await runProbe(edge, 'mobile', 560, 900, 30000);
      const r2 = printProbe(mobile);
      probeFails += r2.fail;

      if (WITH_OCR) {
        // 把 CDN 域名黑洞掉，证明识别不依赖外网；用调试端口保活以等真实时间完成
        const ocr = await runProbe(
          edge,
          'ocr',
          900,
          700,
          150000,
          [
            '--remote-debugging-port=9334',
            '--host-resolver-rules=MAP cdn.jsdelivr.net 127.0.0.1, MAP tessdata.projectnaptha.com 127.0.0.1, MAP unpkg.com 127.0.0.1',
          ],
          { virtualTime: false },
        );
        const r3 = printProbe(ocr);
        probeFails += r3.fail;
      }
    }
    try {
      server && server.kill();
    } catch {
      /* ignore */
    }
  }

  steps.push(['画幅探针', probeFails === 0]);

  const failed = steps.filter(([, ok]) => !ok);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n' + '─'.repeat(56));
  for (const [name, ok] of steps) console.log(`${ok ? '✓' : '✗'} ${name}`);
  console.log('─'.repeat(56));
  if (failed.length === 0) {
    console.log(`全部通过 · ${secs}s${WITH_OCR ? '（含离线 OCR）' : ''}`);
    process.exit(0);
  }
  console.log(`失败 ${failed.length} 项 · ${secs}s`);
  process.exit(1);
})();
