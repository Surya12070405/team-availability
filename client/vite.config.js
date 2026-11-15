import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, forward /api calls to the Express server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['team-availability-repository-client.v0.build'],
    proxy: { '/api': 'http://localhost:5000' },
  },
});
