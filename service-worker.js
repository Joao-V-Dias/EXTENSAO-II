// Service Worker do Prato Cheio.
//
// Objetivo: o app abrir e operar 100% offline. Faz cache "app shell" (HTML,
// CSS, JS, ícones, bibliotecas vendorizadas) na instalação. Chamadas à API
// do Supabase NUNCA passam pelo cache — vão direto à rede e, se falharem,
// quem decide o que fazer é a camada de sincronização (js/sync.js), que
// grava localmente no IndexedDB e tenta de novo depois.

const CACHE_VERSION = "prato-cheio-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/estilo.css",
  "./js/util.js",
  "./js/config.js",
  "./js/db-local.js",
  "./js/cripto.js",
  "./js/auth.js",
  "./js/sync.js",
  "./js/familias.js",
  "./js/estoque.js",
  "./js/entregas.js",
  "./js/relatorios.js",
  "./js/app.js",
  "./vendor/dexie.min.js",
  "./vendor/supabase.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            .filter((nome) => nome !== CACHE_VERSION)
            .map((nome) => caches.delete(nome))
        )
      )
      .then(() => self.clients.claim())
  );
});

function ehChamadaDeApi(url) {
  return url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Chamadas à API: sempre rede, nunca cache (dado sensível não deve ficar
  // em cache HTTP do navegador; quem cuida de offline aqui é o IndexedDB).
  if (ehChamadaDeApi(url)) {
    return;
  }

  if (event.request.method !== "GET") {
    return;
  }

  // App shell: cache-first, com atualização em segundo plano quando online.
  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      const buscaRede = fetch(event.request)
        .then((respostaRede) => {
          if (respostaRede && respostaRede.ok) {
            const copia = respostaRede.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copia));
          }
          return respostaRede;
        })
        .catch(() => respostaCache);

      return respostaCache || buscaRede;
    })
  );
});
