const { app, BrowserWindow, shell, Menu, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DIST = path.join(__dirname, '..', 'dist');

/**
 * 打包后不能用 file:// 加载页面：
 * file:// 下 Worker 与 fetch 都受限，本地 OCR 的引擎与语言包无法读取。
 * 这里注册 app:// 协议把 dist 当成同源站点服务，页面/Worker/语言包都走它。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveFromDist(requestUrl) {
  const url = new URL(requestUrl);
  let rel = decodeURIComponent(url.pathname || '/');
  if (rel === '' || rel === '/') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';

  const abs = path.normalize(path.join(DIST, rel));
  // 目录穿越防护
  if (abs !== DIST && !abs.startsWith(DIST + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }

  try {
    const data = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': String(data.length),
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

// 单实例：重复双击聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;

  const createWindow = () => {
    win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1024,
      minHeight: 720,
      show: false,
      backgroundColor: '#F4F2EC',
      title: '线圈本成本核算',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'build', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        webSecurity: true,
      },
    });

    win.loadURL('app://bundle/index.html');
    win.once('ready-to-show', () => win.show());

    // 打包自检：COILBOOK_SELFTEST=1 时验证页面渲染与本地引擎资源可达，然后退出
    if (process.env.COILBOOK_SELFTEST === '1') {
      win.webContents.once('did-finish-load', async () => {
        try {
          const res = await win.webContents.executeJavaScript(`(async () => {
            const out = { title: document.title };
            out.root = !!document.querySelector('#root') && document.querySelector('#root').children.length > 0;
            out.hero = (document.querySelector('.result-amount') || {}).textContent || '';
            out.protocol = location.protocol;
            for (const p of ['tess/worker.min.js','tess/tesseract-core-simd-lstm.wasm.js','ocr/chi_sim.traineddata.gz']) {
              try { const r = await fetch(p); out[p] = r.status + ':' + (r.headers.get('content-length') || '?'); }
              catch (e) { out[p] = 'ERR ' + e.message; }
            }
            return JSON.stringify(out);
          })()`);
          fs.writeFileSync(path.join(app.getPath('temp'), 'coilbook-selftest.json'), res);
          console.log('SELFTEST ' + res);
        } catch (e) {
          console.log('SELFTEST_ERR ' + e.message);
        }
        setTimeout(() => app.quit(), 400);
      });
    }

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    win.on('closed', () => {
      win = null;
    });
  };

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (req) => serveFromDist(req.url));
    require('./secrets.cjs').registerSecrets();
    require('./updater.cjs').registerUpdater();

    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
          { role: 'toggleDevTools', label: '开发者工具' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于',
            click: () => {
              if (win) {
                win.webContents.executeJavaScript(
                  `window.alert && window.alert('线圈本成本核算\\n全工艺成本 · 报价 · 识图 · AI 助手');`,
                );
              }
            },
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
