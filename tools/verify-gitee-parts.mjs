// 验证 Gitee 分片链路：读清单 → 下载各分片 → 拼接 → 校验 SHA-256
// 用法：node tools/verify-gitee-parts.mjs <tag>
import { createWriteStream, createReadStream, statSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tag = process.argv[2] || 'v1.2.3';
const OWNER = 'neutronfair';
const REPO = 'Margin';
const API = `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/latest`;
const dir = join(tmpdir(), 'gitee-parts-check');
mkdirSync(dir, { recursive: true });

const rel = await (await fetch(API, { headers: { Accept: 'application/json' } })).json();
if (String(rel.tag_name) !== tag) {
  console.log(`WARN 最新 Release 是 ${rel.tag_name}，但要求验证 ${tag}`);
}
const assets = rel.assets || [];
const manifestAsset = assets.find((a) => /\.exe\.parts\.json$/i.test(a.name));
if (!manifestAsset) throw new Error('没找到分片清单');
const manifest = await (await fetch(manifestAsset.browser_download_url)).json();
console.log('manifest:', JSON.stringify(manifest));

const parts = (manifest.parts || []).slice().sort((a, b) => a.name.localeCompare(b.name));
const files = [];
for (const p of parts) {
  const asset = assets.find((a) => a.name === p.name);
  if (!asset) throw new Error(`Release 里没有分片 ${p.name}`);
  const dest = join(dir, p.name);
  const res = await fetch(asset.browser_download_url);
  if (!res.ok) throw new Error(`${p.name} 下载失败 HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const got = statSync(dest).size;
  console.log(`  ${p.name}: ${got} 字节（期望 ${p.size}）${got === p.size ? ' ✓' : ' ✗'}`);
  if (got !== p.size) throw new Error(`${p.name} 大小不符`);
  files.push(dest);
}

const out = join(dir, manifest.name);
if (existsSync(out)) rmSync(out, { force: true });
const ws = createWriteStream(out);
for (const f of files) await pipeline(createReadStream(f), ws, { end: false });
await new Promise((r) => ws.end(r));

const size = statSync(out).size;
const hash = await new Promise((resolve, reject) => {
  const h = createHash('sha256');
  const rs = createReadStream(out);
  rs.on('data', (c) => h.update(c));
  rs.on('end', () => resolve(h.digest('hex').toUpperCase()));
  rs.on('error', reject);
});
console.log(`rejoined: ${size} 字节`);
console.log(`sha256  : ${hash}`);
console.log(`expected: ${manifest.sha256}`);
if (size !== manifest.size) throw new Error(`合并后大小不符：${size} ≠ ${manifest.size}`);
if (hash !== String(manifest.sha256).toUpperCase()) throw new Error('SHA-256 不匹配');
console.log('PASS 分片下载 → 拼接 → 校验 全部一致');
for (const f of [...files, out]) rmSync(f, { force: true });
