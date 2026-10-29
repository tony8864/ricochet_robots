import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // RR_* values are development-server configuration, never VITE_* client data.
  const env = loadEnv(mode, process.cwd(), 'RR_');
  let https;
  if (mode === 'https') {
    if (!env.RR_HTTPS_CERT || !env.RR_HTTPS_KEY) {
      throw new Error('HTTPS mode requires RR_HTTPS_CERT and RR_HTTPS_KEY. See docs/local-development.md.');
    }
    // Missing/unreadable certificates must fail startup, not silently use HTTP.
    https = {
      cert: readFileSync(env.RR_HTTPS_CERT),
      key: readFileSync(env.RR_HTTPS_KEY),
    };
  }

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      https,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          ws: true,
          // Preserve the browser's Origin/Host for later authentication checks.
          changeOrigin: false,
        },
      },
    },
  };
});
