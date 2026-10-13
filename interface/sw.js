// Service worker de la version en ligne : garde la dernière page et les dernières données
// pour qu'elles restent lisibles sans connexion ou sur une connexion très lente.

const CACHE = 'veille-v1';
const SOCLE = ['./', 'index.html', 'style.css', 'app.js'];
// Au-delà de ce délai, on affiche la copie gardée pendant que le réseau continue en arrière-plan.
const PATIENCE = 4000;

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SOCLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(cles => Promise.all(cles.filter(cle => cle !== CACHE).map(cle => caches.delete(cle))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord : en ligne, la page reçoit toujours la version la plus récente.
// La copie gardée ne sert que si le réseau échoue ou tarde.
async function repondre(ev) {
  const cache = await caches.open(CACHE);
  const reseau = fetch(ev.request).then(rep => {
    if (rep.ok) cache.put(ev.request, rep.clone());
    return rep;
  });
  ev.waitUntil(reseau.catch(() => {}));
  const copie = await cache.match(ev.request, { ignoreSearch: true });
  if (!copie) return reseau;
  const attente = new Promise(resolve => { setTimeout(() => resolve(copie), PATIENCE); });
  return Promise.race([reseau.catch(() => copie), attente]);
}

self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  ev.respondWith(repondre(ev));
});
