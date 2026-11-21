const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('安全存储不可用时拒绝操作，不创建明文文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coilbook-secret-test-'));
  let handler;
  const old = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return { app: { getPath: () => dir }, safeStorage: { isEncryptionAvailable: () => false }, ipcMain: { handle: (_name, fn) => { handler = fn; } } };
    return old.call(this, name, ...args);
  };
  try {
    require('./secrets.cjs').registerSecrets();
    const frame = { url: 'app://bundle/index.html' };
    await assert.rejects(handler({ senderFrame: frame, sender: { mainFrame: frame } }, 'set', 'ai:' + 'a'.repeat(64), 'example-secret'), /不可用/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { Module._load = old; fs.rmSync(dir, { recursive: true, force: true }); }
});
