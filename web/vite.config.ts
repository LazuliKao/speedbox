import { defineConfig } from 'vite';
import swc from 'vite-plugin-swc-transform';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    swc({
      swcOptions: {
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: true,
          },
          transform: {
            react: {
              runtime: 'automatic',
              importSource: 'preact',
            },
          },
          target: 'es2020',
          minify: {
            compress: {
              unused: true,
              drop_console: false,
              drop_debugger: false,
            },
            mangle: true,
          },
        },
      },
    }),
  ],
  base: './',
  build: {
    outDir: resolve(__dirname, '../package/luci-app-speedbox/root/www/speedbox'),
    emptyOutDir: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: false,
        passes: 2,
      },
      mangle: true,
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    proxy: {
      '/download': 'http://127.0.0.1:8080',
      '/upload': 'http://127.0.0.1:8080',
      '/info': 'http://127.0.0.1:8080',
      '/ws': {
        target: 'http://127.0.0.1:8080',
        ws: true,
      },
    },
  },
});
