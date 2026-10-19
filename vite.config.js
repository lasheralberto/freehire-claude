import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BRIDGE = `http://127.0.0.1:${process.env.PORT || 8787}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: BRIDGE, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
