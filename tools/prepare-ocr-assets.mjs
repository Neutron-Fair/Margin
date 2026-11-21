/**
 * 把离线 OCR 引擎从 node_modules 复制到 public/tess。
 *
 * 仓库不提交这些二进制（约 7.5MB），首次构建前跑一次即可；幂等，可重复执行。
 * 中文语言包 public/ocr/chi_sim.traineddata.gz 已随仓库提供（约 1.7MB）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const dest = path.join(root, 'public', 'tess');

// `.wasm.js` 是自包含变体（wasm 以 base64 内嵌），无需再 fetch 单独的 .wasm
const FILES = [
  ['tesseract.js', 'dist', 'worker.min.js'],
  ['tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core', 'tesseract-core-lstm.wasm.js'],
];

fs.mkdirSync(dest, { recursive: true });

let copied = 0;
for (const parts of FILES) {
  const src = path.join(nm, ...parts);
  const out = path.join(dest, parts[parts.length - 1]);
  if (!fs.existsSync(src)) {
    console.error(`✗ 缺少源文件（请先 npm install）：${path.relative(root, src)}`);
    process.exit(1);
  }
  const a = fs.statSync(src);
  if (fs.existsSync(out) && fs.statSync(out).size === a.size) continue; // 已就绪
  fs.copyFileSync(src, out);
  copied += 1;
}

const lang = path.join(root, 'public', 'ocr', 'chi_sim.traineddata.gz');
if (!fs.existsSync(lang)) {
  console.error('✗ 缺少中文语言包 public/ocr/chi_sim.traineddata.gz');
  process.exit(1);
}

console.log(
  copied === 0
    ? `OCR 引擎已就绪（${FILES.length} 个文件）`
    : `OCR 引擎已复制 ${copied} 个文件到 public/tess`,
);
