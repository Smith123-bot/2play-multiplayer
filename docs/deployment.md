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

* Set `TRUST_PROXY` so the HTTP rate limiter sees the real client IP.
* Keep `pingInterval` (10 s) and `pingTimeout` (20 s) below any proxy idle timeout
  (60 s+ recommended), otherwise mobile clients will be dropped.

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
