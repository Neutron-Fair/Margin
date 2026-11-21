import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic' },
  // 渲染层需要知道自己的版本号：桌面端以 Electron 的 app.getVersion() 为准，
  // 手机/浏览器端用这里注入的构建版本。两者必须在同一版里对齐。
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2500,
  },
  server: { port: 5199, host: '127.0.0.1' },
});
