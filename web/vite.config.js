import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: resolve(__dirname, '../package/luci-app-speedbox/root/www/speedbox'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/download': 'http://127.0.0.1:8080',
      '/upload': 'http://127.0.0.1:8080',
      '/info': 'http://127.0.0.1:8080',
    },
  },
});
