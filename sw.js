// ═══════════════════════════════════════════════
//  MedTrack PWA — Service Worker
//  Estratégia: Cache-first para app shell,
//              Network-first para API do Sheets
// ═══════════════════════════════════════════════

const CACHE_NAME    = 'medtrack-v2.0';
const CACHE_STATIC  = 'medtrack-static-v2.0';
const CACHE_FONTS   = 'medtrack-fonts-v2.0';

// Recursos essenciais para funcionar offline
const APP_SHELL = [
  './index.html',
];

// Origens que devem ir sempre para a rede (Google Sheets API)
const NETWORK_ONLY_ORIGINS = [
  'script.google.com',
  'sheets.googleapis.com',
];

// ─── INSTALL ────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando MedTrack v2.0...');
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      console.log('[SW] Cacheando app shell');
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ───────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Ativando MedTrack v2.0...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_STATIC && key !== CACHE_FONTS)
          .map(key => {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ─── FETCH ──────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API do Google Sheets → sempre rede, nunca cache
  if (NETWORK_ONLY_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Offline: retorna resposta vazia para não travar a app
        return new Response(JSON.stringify({ offline: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 2. Google Fonts → Cache-first (fontes raramente mudam)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_FONTS).then(cache => {
        return cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // 3. App Shell (HTML, CSS, JS locais) → Cache-first com fallback de rede
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Atualiza o cache em background (stale-while-revalidate)
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_STATIC).then(cache => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        }).catch(() => null);

        return cached;
      }

      // Não está no cache → busca na rede
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_STATIC).then(cache => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        // Fallback para index.html quando offline e rota não encontrada
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ─── PUSH NOTIFICATIONS (preparado para futuro) ─
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'MedTrack', {
    body: data.body || 'Hora de tomar seu remédio! 💊',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [200, 100, 200],
    tag: 'medtrack-reminder',
    actions: [
      { action: 'tomar', title: '✅ Marcar tomado' },
      { action: 'depois', title: '⏰ Lembrar depois' }
    ]
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('./')
  );
});
