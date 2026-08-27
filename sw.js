// ⚠ Bump CACHE_VERSION à chaque mise en ligne : c'est ce qui déclenche
// la purge de l'ancien cache sur les téléphones déjà installés.
const CACHE_VERSION = 'v3';
const CACHE_NAME = 'jardinator-' + CACHE_VERSION;

// Chemins relatifs : le SW est servi depuis la racine de l'app, donc
// ils suivent l'hébergement. L'ancienne version codait en dur
// « /jardinator-app/ » et retombait sur « /index.html » — un chemin qui
// n'était jamais en cache, donc pas de mode hors-ligne du tout.
const ASSETS = ['./', './index.html', './manifest.json', './logo.jpg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // addAll échoue en bloc si un seul fichier manque : on tolère.
      .then(cache => Promise.all(ASSETS.map(u => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Les appels à Apps Script ne passent jamais par le cache : servir une
  // liste de chantiers périmée serait pire que ne rien servir.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigation : réseau d'abord. En cache-first, une nouvelle version de
  // l'app n'atteignait jamais les téléphones déjà installés.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Assets : cache d'abord, et on rafraîchit la copie en arrière-plan.
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
