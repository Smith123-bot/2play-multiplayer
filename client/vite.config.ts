import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const SERVER_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@2play/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Allows the app to be opened through proxied development hosts (previews).
    allowedHosts: true,
    proxy: {
      '/api': { target: SERVER_TARGET, changeOrigin: true },
      '/socket.io': { target: SERVER_TARGET, ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': { target: SERVER_TARGET, changeOrigin: true },
      '/socket.io': { target: SERVER_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    /**
     * Routes and the 39 game clients are code-split, so the entry chunk should
     * stay well under Vite's 500 KB default. This used to be raised to 900 to
     * silence the warning from a single 850 KB bundle that contained every game;
     * keeping a real limit means a future regression is reported at build time.
     */
    chunkSizeWarningLimit: 500,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    css: false,
  },
});
