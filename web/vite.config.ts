/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the dev server forwards the API to the running system (docker compose up -d),
// exactly like nginx does in the container, so the site always talks to its own origin.
const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8080'
const monitor = process.env.MONITOR_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': gateway,
      '/monitor': { target: monitor, rewrite: (path) => path.replace(/^\/monitor/, '') },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
