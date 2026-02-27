import { readFileSync } from 'fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

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
  define: {
    PKG_VERSION: JSON.stringify(pkg.version),
  },
});
