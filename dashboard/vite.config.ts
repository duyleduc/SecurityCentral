import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { cwd: () => string };

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: loadEnv(mode, process.cwd(), '').VITE_BASE_URL || '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/v1': 'http://localhost:3000',
      '/ws': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
}));
