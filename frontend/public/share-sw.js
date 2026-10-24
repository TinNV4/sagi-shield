// Web Share Target: the OS share sheet POSTs text / screenshots to /share-target. Imported into the generated service
// worker (vite.config.ts, workbox.importScripts). The shared content is parked in Cache Storage on this device only,
// then the app opens at /#share and src/lib/shareInbox.ts reads it once and deletes it. Never sent to a network.
const SHARE_CACHE = 'sagi-share';

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'POST') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      try {
        const form = await request.formData();
        const cache = await caches.open(SHARE_CACHE);
        for (const key of await cache.keys()) await cache.delete(key); // a new share replaces an unread one
        const field = (name) => {
          const value = form.get(name);
          return typeof value === 'string' ? value : '';
        };
        const files = form.getAll('images').filter((f) => typeof f !== 'string');
        const index = {
          title: field('title'),
          text: field('text'),
          url: field('url'),
          files: files.map((f) => ({name: f.name || 'shared', type: f.type || ''})),
        };
        await cache.put('/share-inbox', new Response(JSON.stringify(index), {headers: {'Content-Type': 'application/json'}}));
        for (let i = 0; i < files.length; i++) {
          await cache.put('/share-inbox/' + i, new Response(files[i], {headers: {'Content-Type': files[i].type || 'application/octet-stream'}}));
        }
      } catch (e) {
        // a share that cannot be stored just opens the app empty
      }
      return Response.redirect('/#share', 303);
    })()
  );
});
