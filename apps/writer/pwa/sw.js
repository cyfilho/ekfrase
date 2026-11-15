// SPDX-License-Identifier: MPL-2.0
/*
 * Service worker do Ekfrase Writer: deixa o app ABRIR e ESCREVER sem internet depois da primeira
 * visita. Os textos não moram aqui (moram no IndexedDB, `packages/writer-nucleo`); aqui fica só a
 * casca: a página, o JS, o CSS, as fontes e os ícones.
 *
 * O build (`pwa/plugin.ts`) põe antes deste código `self.WRITER_OFFLINE = { versao, arquivos }`: a
 * lista de TODOS os arquivos do build e um código que muda sempre que um deles muda (então este
 * arquivo muda, e o navegador instala a versão nova sozinho).
 *
 * Regras (o cuidado de 08/11/2026: uma página velha pedindo um JS que já não existe fica em branco):
 * - A página (`index.html`) e os arquivos dela entram JUNTOS no mesmo cache, um por versão
 *   (`writer-<versao>`). A página guardada só pede arquivos que estão no mesmo cache.
 * - Abrir o app: rede primeiro (pega a versão nova logo); sem rede, ou se a rede demora, a página
 *   da versão guardada. A página que veio da rede NUNCA é guardada fora da sua versão.
 * - Arquivos: cache primeiro (em qualquer versão guardada), depois a rede.
 * - Versão nova assume na hora (`skipWaiting` + `clients.claim`), mas o cache da versão anterior
 *   fica até a próxima: a aba que ainda roda o JS velho continua achando os pedaços dele.
 * - `/api` nunca passa por aqui.
 */
const { versao: VERSAO, arquivos: ARQUIVOS } = self.WRITER_OFFLINE;
const PREFIXO = 'writer-';
const CACHE = PREFIXO + VERSAO;
const ESCOPO = new URL(self.registration.scope);
const PAGINA = new URL('index.html', ESCOPO).href;
/** Quanto esperar a rede ao abrir o app antes de usar a página guardada. */
const ESPERA_REDE_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ARQUIVOS.map((a) => new Request(new URL(a, ESCOPO).href, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) => {
        // as chaves vêm na ordem em que os caches foram criados: fica a atual e a anterior
        const nossos = nomes.filter((n) => n.startsWith(PREFIXO) && n !== CACHE);
        const anterior = nossos[nossos.length - 1];
        return Promise.all(nossos.filter((n) => n !== anterior).map((n) => caches.delete(n)));
      })
      .then(() => self.clients.claim()),
  );
});

function comPrazo(promessa, ms) {
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error('prazo')), ms);
    promessa.then(
      (r) => (clearTimeout(t), ok(r)),
      (err) => (clearTimeout(t), falha(err)),
    );
  });
}

async function abrirPagina(pedido) {
  try {
    const r = await comPrazo(fetch(pedido), ESPERA_REDE_MS);
    if (r.ok) return r;
    const guardada = await caches.match(PAGINA, { cacheName: CACHE, ignoreVary: true });
    return guardada ?? r;
  } catch (err) {
    const guardada = (await caches.match(PAGINA, { cacheName: CACHE, ignoreVary: true })) ?? (await caches.match(PAGINA, { ignoreVary: true }));
    if (guardada) return guardada;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== ESCOPO.origin) return;
  if (!url.pathname.startsWith(ESCOPO.pathname) || url.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(abrirPagina(e.request));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true, ignoreVary: true }).then((guardado) => guardado ?? fetch(e.request)));
});
