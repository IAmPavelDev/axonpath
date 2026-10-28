import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/emit-openapi.ts'],
  format: ['cjs'],
  splitting: true,
  sourcemap: true,
  clean: true,
});