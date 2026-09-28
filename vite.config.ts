import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
      },
      // Vite doesn't register a service worker in dev by default, so
      // navigator.serviceWorker.ready (used by the push subscribe/
      // unsubscribe flow) would hang forever without this — needed to
      // test notifications locally, not just in a production build.
      // Left off for now: the dev SW aggressively caches the app shell,
      // which made ordinary UI changes look "reverted" until it was
      // manually unregistered. Flip back to true when testing push.
      devOptions: {
        enabled: false,
        type: 'module',
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Touq',
        short_name: 'Touq',
        description: 'Medical record tracking for veterinary clinics',
        theme_color: '#B8860B',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
