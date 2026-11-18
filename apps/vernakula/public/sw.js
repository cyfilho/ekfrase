// SPDX-License-Identifier: MPL-2.0
/*
 * Service worker do Vernákula: guarda a casca do app (HTML, JS, CSS, fontes,
 * ícones) para abrir sem internet. Os pedidos à /api NUNCA passam pelo cache:
 * dado de aluno não fica guardado aqui (a guarda offline dos dados é outra
 * camada, com regras próprias).
 *
 * Estratégia: rede primeiro para a página, em qualquer caminho de /vernakula/ (pega a versão nova logo), cache
 * primeiro para arquivos com hash no nome (nunca mudam).
 */
const CACHE = 'vernakula-casca-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icones/icone-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith('vernakula-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          // qualquer endereço dentro de /vernakula/ (/app/conta, /convite/<código>…) é o mesmo index.html
          if (r.ok) {
            const copia = r.clone();
            void caches.open(CACHE).then((c) => c.put('./', copia));
          }
          return r;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(
      (guardado) =>
        guardado ??
        fetch(e.request).then((r) => {
          if (r.ok && url.pathname.includes('/assets/')) {
            const copia = r.clone();
            void caches.open(CACHE).then((c) => c.put(e.request, copia));
          }
          return r;
        }),
    ),
  );
});
