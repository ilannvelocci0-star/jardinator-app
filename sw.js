// Incrémenter à chaque mise en ligne qui touche autre chose que
// index.html : la page elle-même est servie réseau d'abord, donc elle se
// met à jour seule, mais le logo, les icônes et le manifeste sont servis
// depuis le cache. Changer cette valeur purge tout d'un coup.
const CACHE_VERSION = 'v5';
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
    const versionCache = () => caches.match(req).then(r => r || caches.match('./index.html'));

    e.respondWith(
      Promise.race([
        fetch(req).then(res => {
          // Ne mettre en cache que les réponses valides : une page
          // d'erreur mémorisée serait ensuite servie hors ligne comme si
          // c'était l'application.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        }),
        // Un réseau de chantier qui répond sans jamais conclure — 2G,
        // portail captif — laissait l'écran blanc pendant tout le délai
        // TCP, alors que l'app était en cache. Au-delà de 4 s, on sert
        // la copie locale.
        new Promise(r => setTimeout(() => r(null), 4000))
      ])
        .then(res => res || versionCache())
        .catch(versionCache)
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
