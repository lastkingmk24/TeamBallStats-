/* Version this cache whenever the app shell changes. Never cache league data or API responses. */
'use strict';
const CACHE = 'teamballstats-shell-v2';
const ASSETS = [
  "./",
  "index.html",
  "css/style.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "js/access.js",
  "js/analytics.js",
  "js/app.js",
  "js/auth.js",
  "js/boxscores.js",
  "js/cloud.js",
  "js/dashboard.js",
  "js/export.js",
  "js/leaders.js",
  "js/live.js",
  "js/merge.js",
  "js/mobile.js",
  "js/pdf.js",
  "js/photos.js",
  "js/plays.js",
  "js/pro.js",
  "js/profiles.js",
  "js/proui.js",
  "js/reports.js",
  "js/schedule.js",
  "js/share.js",
  "js/shortcuts.js",
  "js/shotchart.js",
  "js/standings.js",
  "js/stats.js",
  "js/storage.js",
  "js/summary.js",
  "js/teams.js",
  "js/theme.js",
  "js/ui.js"
];
const scope = new URL(self.registration.scope);
const assetUrls = new Set(ASSETS.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  // addAll is atomic: a failed download must not replace a working shell.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('teamballstats-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;
  // Only the exact app shell is cached; API, user data and other URLs go to the network.
  url.search = '';
  url.hash = '';
  if (!assetUrls.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(url.href))
    .then(response => response || fetch(request)));
});
