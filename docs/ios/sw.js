// Works offline: everything is saved on the phone the first time it opens.
// Opens from the saved copy (instant, no signal needed) and quietly fetches
// updates in the background, so a new version shows up on the next launch.
// Bump CACHE when the list of files changes.
const CACHE = "hiragana-ios-2";
const FILES = [
  "./", "index.html", "app.js", "styles.css", "manifest.webmanifest", "apple-touch-icon.png",
  "../store.js", "../kana.js", "../data.js", "../icon-192.png",
  "../fonts/CrimsonPro-Italic.woff2",
  "../fonts/DotGothic16-Regular.woff2",
  "../fonts/KleeOne-Regular.woff2",
  "../fonts/KleeOne-SemiBold.woff2",
  "../fonts/KosugiMaru-Regular.woff2",
  "../fonts/NotoSansJP.woff2",
  "../fonts/NotoSerifJP.woff2",
  "../fonts/Yomogi-Regular.woff2",
  "../fonts/ZenKurenaido-Regular.woff2",
  "../fonts/fonts.css",
];
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("hiragana-ios-") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const key = e.request.mode === "navigate" ? new URL("./", location).href : e.request;
    const cached = await c.match(key, { ignoreSearch: true });
    const fresh = fetch(e.request, { cache: "no-cache" }).then((res) => {
      if (res.ok) c.put(key, res.clone());
      return res;
    });
    if (cached) { e.waitUntil(fresh.catch(() => {})); return cached; }
    return fresh;
  }));
});
