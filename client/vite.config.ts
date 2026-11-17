import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API runs on :4000; proxy /api so the browser talks to a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
