import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE || './',
  server: { host: true, port: 5175 },
  build: { outDir: 'dist', assetsDir: 'assets' },
});
