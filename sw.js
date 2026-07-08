// Service worker minimal pour rendre la caisse Gin Khao installable en PWA (Chrome),
// SANS casser l'ouverture en plein écran.
//
// Règle clé : on NE TOUCHE PAS aux navigations (chargement des pages). Elles vont
// directement au réseau — ça évite le bug "PWA qui refuse de s'ouvrir" quand Netlify
// réécrit /pos vers /pos.html. On met seulement en cache les fichiers statiques
// (CSS/JS/icônes) du même domaine, en réseau d'abord.

const CACHE = 'gin-khao-caisse-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 1) Jamais les navigations (ouverture/rechargement de page) → réseau direct.
  if (req.mode === 'navigate') return;
  // 2) Uniquement les GET du même domaine (pas Supabase, pas les fonts, pas les POST).
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
