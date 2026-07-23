import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite binds to localhost over IPv6 (::1) on this machine — http://127.0.0.1
// times out, use http://localhost.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
