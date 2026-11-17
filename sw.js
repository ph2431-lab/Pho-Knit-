/* Purl & Page offline: caches the app and the PDF reader, and serves stored files at ./_blob/<id> from IndexedDB. */
const VERSION = 'pp-v1';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const REMOTE = [PDFJS + 'pdf.min.js', PDFJS + 'pdf.worker.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled([...SHELL, ...REMOTE].map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function blobFromDb(id) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('purlpage', 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs'); if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs'); };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const g = r.result.transaction('blobs').objectStore('blobs').get(id); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); };
  });
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const m = url.origin === location.origin && url.pathname.match(/\/_blob\/([0-9a-f]{32})$/);
  if (m) {
    e.respondWith(blobFromDb(m[1]).then(rec => rec ? new Response(rec.blob, { headers: { 'Content-Type': rec.type || 'application/octet-stream', 'Cache-Control': 'no-store' } }) : new Response('Not found', { status: 404 })).catch(() => new Response('Not found', { status: 404 })));
    return;
  }
  /* the app's own files: network first so updates arrive, the cached copy when offline */
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request.mode === 'navigate' ? './index.html' : e.request, cp)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : new Response('', { status: 504 })))));
    return;
  }
  /* PDF reader and fonts: cache first */
  if (url.host === 'cdnjs.cloudflare.com' || url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; })));
  }
});
