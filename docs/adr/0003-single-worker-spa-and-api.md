# Single Worker serves both the React PWA and the JSON API

One Worker serves the built React SPA via Workers Static Assets (including the
PWA manifest and service worker) and hosts the JSON API on the same origin.

Same-origin means no CORS and a simple session-cookie story. One build, one
deploy. Rejected: CF Pages + separate API Worker (cross-origin cookie/CORS
friction, two deploys) and an SSR framework (overkill for an app-shell PWA that
lives behind login).
