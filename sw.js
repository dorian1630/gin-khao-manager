// ============================================================
// SERVICE WORKER — Gin Khao Caisse PWA
// ============================================================
// Permet à pos.html d'être installé comme une app sur la tablette
// et de fonctionner même hors-ligne (basique)
// ============================================================

const CACHE_NAME = 'gin-khao-caisse-v1';
const ASSETS = [
  '/pos.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install : pré-cache les fichiers essentiels
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS).catch(err => {
        console.warn('Pré-cache partiel:', err);
      }))
  );
  self.skipWaiting();
});

// Activate : nettoyer les vieux caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Fetch : Network-first pour rester à jour, fallback cache si offline
self.addEventListener('fetch', event => {
  // Skip non-GET et les requêtes vers d'autres domaines (Supabase, fonts, etc.)
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  // Skip aussi les requêtes vers le serveur d'impression localhost
  if (event.request.url.includes('localhost:9100')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Mettre à jour le cache avec la dernière version
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
