import { defineConfig } from 'vite';

// In dev, /ws is proxied to the local room server (cd server && npm start).
export default defineConfig({
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8790', ws: true },
    },
  },
});
