import { defineConfig } from 'vite';
import viteReact from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The game runs inside the host's iframe on a different origin and the host fetches
// /game.manifest.json cross-origin, so CORS must stay open — same as the SDK coinflip example.
// `frame-ancestors *` / no `X-Frame-Options` is a hosting-header job (see scripts/headers.json).
export default defineConfig({
  plugins: [viteReact()],
  server: { port: 3200, cors: true },
  preview: { port: 3200, cors: true },
  resolve: {
    alias: {
      '@chain/casino-sdk/guest': resolve(import.meta.dirname, '../../src/guest.ts'),
      '@chain/casino-sdk': resolve(import.meta.dirname, '../../src/index.ts'),
    },
  },
  build: {
    // The whole game is one small bundle; no dynamic imports so the iframe is interactive fast.
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});