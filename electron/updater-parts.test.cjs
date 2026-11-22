// 分片拼接与校验的单测：这条链路一旦出错就是"装了个坏包"，比普通逻辑更值得盯
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// updater.cjs 依赖 electron 的 app/ipcMain，测试时给个最小替身
const oldLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { getPath: () => os.tmpdir() }, ipcMain: { handle() {} } };
  return oldLoad.call(this, name, ...args);
};
const { mergeParts, sha256File } = require('./updater.cjs');
Module._load = oldLoad;

function makeParts(dir, sizes) {
  const files = [];
  sizes.forEach((size, i) => {
    const p = path.join(dir, `part${i + 1}`);
    const buf = crypto.randomBytes(size);
    fs.writeFileSync(p, buf);
    files.push(p);
  });
  return files;
}

test('按顺序拼接分片，大小与 SHA-256 都通过', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-parts-'));
  try {
    const files = makeParts(dir, [2048, 1536, 1024]);
    const expected = Buffer.concat(files.map((f) => fs.readFileSync(f)));
    const sha = crypto.createHash('sha256').update(expected).digest('hex');
    const out = path.join(dir, 'merged.exe');
    const res = await mergeParts(files, out, { expectedSize: expected.length, expectedSha256: sha });
    assert.equal(res.size, expected.length);
    assert.deepEqual(fs.readFileSync(out), expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('大小不符时拒绝并清掉半成品', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-parts-'));
  try {
    const files = makeParts(dir, [2048, 1024]);
    const out = path.join(dir, 'merged.exe');
    await assert.rejects(
      () => mergeParts(files, out, { expectedSize: 9999 }),
      /大小不符/,
    );
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SHA-256 不匹配时拒绝并清掉半成品', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-parts-'));
  try {
    const files = makeParts(dir, [2048, 1024]);
    const out = path.join(dir, 'merged.exe');
    const wrong = 'a'.repeat(64);
    await assert.rejects(
      () => mergeParts(files, out, { expectedSize: 3072, expectedSha256: wrong }),
      /SHA-256 不一致/,
    );
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('太小（<1KB）的合并结果视为不完整', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-parts-'));
  try {
    const files = makeParts(dir, [10, 10]);
    const out = path.join(dir, 'merged.exe');
    await assert.rejects(() => mergeParts(files, out, {}), /不完整/);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sha256File 与 crypto 计算结果一致', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-parts-'));
  try {
    const p = path.join(dir, 'x.bin');
    const buf = crypto.randomBytes(64 * 1024);
    fs.writeFileSync(p, buf);
    const expect = crypto.createHash('sha256').update(buf).digest('hex');
    assert.equal(await sha256File(p), expect);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
