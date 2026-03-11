// CH Geladas PDV — Service Worker
// BUMP esta versão a cada deploy para forçar atualização do cache nos clientes
const CACHE_NAME = 'ch-geladas-v2';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  // Módulos JS — obrigatórios para funcionamento offline
  '/app-dialogs.js',
  '/app-core.js',
  '/app-financeiro.js',
  '/app-ia.js',
  '/app-delivery.js',
  '/app-ponto.js',
  '/app-comanda.js',
  '/app-notif.js',
  '/firebase.js',
  '/sync.js',
  // Ícones PWA
  '/icon-72.png',
  '/icon-96.png',
  '/icon-128.png',
  '/icon-144.png',
  '/icon-152.png',
  '/icon-192.png',
  '/icon-384.png',
  '/icon-512.png'
];

// Instalação: pré-cacheia os assets essenciais
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Ativação: remove caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: serve do cache, com fallback para rede (cache-first)
self.addEventListener('fetch', (event) => {
  // Ignora requisições não-GET e externas (Firebase, Telegram, etc.)
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cacheia apenas respostas válidas do próprio domínio
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
