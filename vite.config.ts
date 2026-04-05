import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Ikamba VPN',
        short_name: 'Ikamba VPN',
        description: 'Premium VPN — private, fast, works in Russia and restricted regions.',
        theme_color: '#000000',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/dashboard',
        scope: '/',
        icons: [
          { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
        screenshots: [
          { src: '/screenshot-wide.svg', sizes: '1280x720', type: 'image/svg+xml', form_factor: 'wide' },
        ],
        categories: ['utilities', 'productivity'],
      },
      workbox: {
        // Cache app shell + assets
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Runtime cache: Firebase + API calls network-first
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'firestore-cache', networkTimeoutSeconds: 5 },
          },
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'firebase-storage', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /^https:\/\/ikambavpn\.duckdns\.org:4443\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'vpn-api', networkTimeoutSeconds: 8 },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/vpnr-api': {
        target: 'http://127.0.0.1:5001/ikamba-1c669/us-central1/vpnrProxy',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/vpnr-api/, ''),
      },
    },
  },
})
