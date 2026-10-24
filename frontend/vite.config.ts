import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {envLabel, pwaNames} from './src/lib/envLabel';

export default defineConfig(() => {
  // the pilot build (VITE_ENV_LABEL=PILOT) installs under its own name next to the production PWA
  const names = pwaNames(envLabel(process.env.VITE_ENV_LABEL));
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: names.name,
          short_name: names.short_name,
          description: 'Fraud prevention PWA against phone scams and fake police impersonation.',
          theme_color: '#1B4D3E',
          background_color: '#F8FAF8',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          cleanupOutdatedCaches: true,
          // guardian alerts by FCM web push (public/push-sw.js): one worker for the app shell and the notifications
          importScripts: ['push-sw.js'],
          // the API lives on the same origin: never answer its routes with the cached app shell
          navigateFallbackDenylist: [/^\/(check|precheck|report|stats|health|healthz|family|agent|ws|spike|docs|openapi\.json)/],
          // recorded alert voices (public/voice): not precached (3 languages x 3 clips), cached on first fetch so an
          // alarm still speaks offline; speak.ts fetches them whole, so no Range requests reach this cache
          runtimeCaching: [
            {
              urlPattern: ({url}) => url.pathname.startsWith('/voice/'),
              handler: 'StaleWhileRevalidate',
              options: {cacheName: 'alert-voice', expiration: {maxEntries: 12}},
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
