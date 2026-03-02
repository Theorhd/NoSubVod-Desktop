import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  base: '/',
  cacheDir: '../../node_modules/.vite-renderer',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: ['es2021', 'chrome100', 'safari13'],
    minify: process.env.TAURI_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  server: {
    port: 5174,
    strictPort: true,
    // Prevent Vite from obscuring Rust errors
    hmr: {
      protocol: 'ws',
      host: 'localhost',
    },
  },
  // Ensure environment variables with TAURI_ prefix are exposed
  envPrefix: ['VITE_', 'TAURI_'],
});
