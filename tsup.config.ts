import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist/cli',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
