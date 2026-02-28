import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main/index.ts' },
  outDir: 'dist',
  format: ['cjs'],
  target: 'node18',
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['electron'],
});
