import { defineConfig } from 'vitest/config';
import swc from 'vite-plugin-swc-transform';

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
        },
      },
    }),
  ],
  test: {
    environment: 'jsdom',
  },
});
