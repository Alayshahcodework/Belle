import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // expose on LAN so a phone can be the patient tablet during the demo
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
});
