# PWA install production deployment

This commit intentionally triggers the GitHub-to-Vercel production integration after the complete Android PWA installability fix landed on `main`.

Included before this trigger:
- 192x192 app icon
- 512x512 app icon
- installable web app manifest with id/scope/icons
- service worker registration
- primary-calendar read routing fix
