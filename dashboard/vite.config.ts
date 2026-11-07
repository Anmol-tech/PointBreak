import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two separate platforms from one codebase:
// index.html → Falcon's control center (served by the gateway on :8000)
// vendor.html → the vendor portal (served by the vendor runtime on :9001)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        vendor: 'vendor.html',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
