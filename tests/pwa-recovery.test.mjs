import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serviceWorker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const notFound = readFileSync(new URL('../app/not-found.tsx', import.meta.url), 'utf8');
const registration = readFileSync(new URL('../app/ServiceWorkerRegistration.tsx', import.meta.url), 'utf8');

test('PWA cache never persists HTTP error responses', () => {
  assert.match(serviceWorker, /if \(response\.ok\)/);
  assert.match(serviceWorker, /event\.request\.mode === 'navigate'/);
  assert.doesNotMatch(serviceWorker, /cache\.put\(event\.request, clone\);\s*return response;/s);
});

test('installed standalone app recovers stale saved routes to root', () => {
  assert.match(notFound, /display-mode: standalone/);
  assert.match(notFound, /navigator.*standalone/s);
  assert.match(notFound, /location\.replace\('\/'\)/);
});

test('service worker update bypasses HTTP cache', () => {
  assert.match(registration, /updateViaCache: 'none'/);
  assert.match(registration, /registration\.update\(\)/);
});
