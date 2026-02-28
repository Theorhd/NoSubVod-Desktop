import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../../dist/portal',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:23455',
        changeOrigin: true,
      },
    },
  },
});
