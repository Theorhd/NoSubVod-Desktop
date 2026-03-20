import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  root: __dirname,
  base: '/',
  cacheDir: '../../node_modules/.vite-portal',
  plugins: [react(), basicSsl()],
  build: {
    outDir: '../../dist/portal',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    https: {},
    proxy: {
      '/api': {
        target: 'http://localhost:23455',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
