const { safeStorage, ipcMain, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function registerSecrets() {
  ipcMain.handle('secrets:access', async (event, action, id, value) => {
    const u = new URL(event.senderFrame.url);
    if (u.protocol !== 'app:' || u.hostname !== 'bundle' || event.senderFrame !== event.sender.mainFrame) throw new Error('不可信的密钥请求');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存或读取密钥');
    if (!/^(ai|ocr|update):[a-f0-9]{64}$/.test(id) || !['get', 'set', 'delete'].includes(action)) throw new Error('无效的密钥请求');
    const dir = path.join(app.getPath('userData'), 'secrets');
    const file = path.join(dir, crypto.createHash('sha256').update(id).digest('hex'));
    if (action === 'get') {
      try { return safeStorage.decryptString(fs.readFileSync(file)); }
      catch (e) { if (e.code === 'ENOENT') return ''; throw new Error('密钥读取失败'); }
    }
    if (action === 'delete') { try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } return ''; }
    if (typeof value !== 'string' || value.length > 16384) throw new Error('无效的密钥');
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, safeStorage.encryptString(value), { mode: 0o600 }); fs.renameSync(tmp, file); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
    return '';
  });
}
module.exports = { registerSecrets };
