import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // In dev: /vpnr-api → Firebase Functions emulator
      '/vpnr-api': {
        target: 'http://127.0.0.1:5001/ikamba-1c669/us-central1/vpnrProxy',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/vpnr-api/, ''),
      },
    },
  },
})
