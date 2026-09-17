# Deployment

## Build

```bash
npm install
npm run build          # shared → server → client
npm start              # node server/dist/server.js
```

The compiled server serves:

* `/api/*` REST endpoints,
* `/socket.io` realtime transport,
* `client/dist` as a single-page app (same origin → relative URLs work everywhere).

## Environment (production)

```env
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
CLIENT_URL=https://play.example.com
CORS_ORIGIN=https://play.example.com
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…
SUPABASE_DB_URL=postgresql://…          # only needed for migrations
LOG_LEVEL=info
MAX_ROOMS=1000
RECONNECT_GRACE_MS=120000
```

Never commit these files. `.env`, `.env.local` and `*.key` are git-ignored.

## Frontend separately (optional)

If you host the SPA on a CDN and the API on another domain:

```env
VITE_API_URL=https://api.example.com
VITE_SOCKET_URL=https://api.example.com
```

and add the SPA origin to `CORS_ORIGIN`.

## Reverse proxy

* Terminate TLS at the proxy and forward both HTTP **and** WebSocket upgrades:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

* **Enable gzip/brotli at the proxy.** The Node server deliberately does not
  compress responses, and the client entry chunk is ~480 KB uncompressed
  (~150 KB gzipped). Without proxy compression every visitor downloads the full
  480 KB:

  ```nginx
  gzip on;
  gzip_comp_level 6;
  gzip_types text/css application/javascript application/json image/svg+xml;
  gzip_vary on;
  ```

* Hashed build assets are served by the API with
  `Cache-Control: public, max-age=31536000, immutable` (a new build always means
  a new filename), while `index.html` is served with `max-age=0` so it
  revalidates. Keep that split if you serve the SPA from a CDN — caching
  `index.html` would pin users to a stale bundle.
* Set `TRUST_PROXY` so the HTTP rate limiter sees the real client IP.
* Keep `pingInterval` (10 s) and `pingTimeout` (20 s) below any proxy idle timeout
  (60 s+ recommended), otherwise mobile clients will be dropped.

## SEO surface

The production site is `https://duoplay.in` (constant `SITE_URL` in
`shared/src/seo`). All public SEO output is generated from the live game
registry, so no file ever hard-codes the game list:

* `/robots.txt` allows the public pages, disallows `/api/`, `/socket.io/`,
  `/room/` and the account flows, and references the sitemap.
* `/sitemap.xml` lists the homepage, `/games` and one URL per registered game.
* Every SPA route is served with its own `<title>`, meta description,
  canonical (always the duoplay.in origin, never the Render hostname),
  Open Graph/Twitter tags, truthful JSON-LD and a crawlable `<noscript>` body
  block. Unknown routes and invalid game ids return a real **404** with a
  `noindex` head; rooms and account pages return 200 with `noindex`.

### Search engine submission (Google & Bing)

1. Deploy, then verify `https://duoplay.in/`, `/robots.txt` and
   `/sitemap.xml` all return 200.
2. **Google Search Console** → add property → "HTML tag" method → set
   `GOOGLE_SITE_VERIFICATION` to the token value and redeploy. The server
   injects `<meta name="google-site-verification" …>` into every page. Click
   Verify, then submit `https://duoplay.in/sitemap.xml`.
3. **Bing Webmaster Tools** → add site → meta tag method → set
   `BING_SITE_VERIFICATION` to the `msvalidate.01` token value and redeploy.
4. **IndexNow (optional push for Bing)**: set `INDEXNOW_KEY` (8–128 chars,
   A–Z a–z 0–9 hyphen). The server serves the ownership proof at
   `https://duoplay.in/<INDEXNOW_KEY>.txt`; run `npm run seo:submit` after
   each deploy to push the full public URL list. The key lives only in the
   environment — it is never committed.

All four variables are documented in `.env.example` and are no-ops when unset.

## Scaling notes

* Rooms are in memory: run a **single instance**, or add a Socket.IO Redis adapter
  plus sticky sessions before scaling horizontally (rooms are keyed by code and
  owned by one process).
* The 30 s maintenance sweep closes empty/expired rooms and prunes caches, so idle
  memory is reclaimed automatically.

## Production checklist

- [ ] `NODE_ENV=production`
- [ ] restricted `CORS_ORIGIN` (no `*`)
- [ ] Supabase credentials present, migrations applied (`npm run db:migrate`)
- [ ] `/api/health` returns `database.mode: "supabase"`, `connected: true`
- [ ] TLS terminated, WebSocket upgrades enabled
- [ ] logs shipped (Winston emits JSON in production)
- [ ] process supervised (systemd / pm2 / container restart policy)
- [ ] `npm run lint`, `npm run typecheck`, `npm run test:all` green before release
