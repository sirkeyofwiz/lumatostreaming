# Reelhouse

A small full-stack movie/TV catalog browser: Node/Express API, a swappable SQLite/Postgres database, user accounts with per-user watchlists, and an admin panel for managing the catalog. All titles, cast, and descriptions are original/fictional — this is a UI and architecture demo, not a real streaming service (there's no video playback).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
*(Push this repo to GitHub first, then use that repo's URL with the button above — see the Deploying section below.)*


## Stack
- **Backend:** Node.js + Express, REST API, cookie sessions (`express-session`)
- **Database:** SQLite locally by default (`better-sqlite3`, zero setup) — set `DATABASE_URL` to switch to Postgres (`pg`) for deployment, no code changes needed
- **Auth:** Username/password, hashed with `bcryptjs`, stored server-side in a session cookie
- **Frontend:** Vanilla HTML/CSS/JS (no build step), served as static files by Express

## Setup

```bash
npm install
npm run seed     # creates reelhouse.db, seeds the catalog, creates an admin user
npm start        # http://localhost:3000
```

The seed script prints an admin login (`admin` / `admin123` by default — set `SEED_ADMIN_PASSWORD` before seeding to choose your own). Sign in with it and visit **/admin.html** to manage the catalog.

For development with auto-restart on file changes:
```bash
npm run dev
```

## Project structure
```
reelhouse-app/
├── server/
│   ├── db/
│   │   ├── index.js   # picks SQLite or Postgres based on DATABASE_URL
│   │   ├── sqlite.js   # better-sqlite3 driver
│   │   ├── postgres.js  # pg driver (same interface as sqlite.js)
│   │   └── schema.js    # DDL for both backends
│   ├── seed.js       # populates the catalog + creates the admin user
│   └── index.js       # Express app, auth, REST API
├── public/
│   ├── index.html / styles.css / app.js     # main site
│   └── admin.html / admin.css / admin.js     # admin panel
├── package.json
├── render.yaml         # Render Blueprint — one-click web service + Postgres
└── reelhouse.db      # created after `npm run seed` (SQLite mode only)
```

## Accounts & permissions
- Anyone can register (`/api/auth/register`) and sign in — this gets them their own watchlist.
- Admins (`is_admin = true` in the `users` table) get access to `/admin.html` and the `/api/admin/*` routes for creating, editing, and deleting titles.
- Sessions are cookie-based (`express-session`). The bundled `MemoryStore` is fine for local use but **resets on restart and leaks memory** — for a real deploy, swap in a persistent store (e.g. `connect-pg-simple` if you're already on Postgres).

## API

| Method | Route                       | Auth       | Description |
|--------|-------------------------------|------------|--------------|
| POST   | `/api/auth/register`           | —          | `{ username, password }` — creates an account and signs in |
| POST   | `/api/auth/login`              | —          | `{ username, password }` |
| POST   | `/api/auth/logout`             | —          |  |
| GET    | `/api/auth/me`                 | —          | Current user or `null` |
| GET    | `/api/genres`                   | —          | Distinct genre list |
| GET    | `/api/titles`                    | —          | Query params: `type`, `genre`, `q`, `sort` |
| GET    | `/api/titles/featured`           | —          | Titles flagged for the homepage hero |
| GET    | `/api/titles/:id`                | —          | Single title |
| GET    | `/api/watchlist`                  | signed in | Current user's watchlist |
| POST   | `/api/watchlist`                  | signed in | `{ titleId }` |
| DELETE | `/api/watchlist/:titleId`          | signed in | |
| GET    | `/api/admin/titles`                 | admin     | Full catalog, unfiltered |
| POST   | `/api/admin/titles`                 | admin     | Create a title |
| PUT    | `/api/admin/titles/:id`             | admin     | Update a title |
| DELETE | `/api/admin/titles/:id`             | admin     | Delete a title |

## Deploying with Render (one click, via Blueprint)

This repo includes a `render.yaml` Blueprint that provisions the web service *and* a free Postgres database together, wires `DATABASE_URL` between them automatically, and seeds the catalog + an admin account on first deploy — no manual dashboard clicking required.

1. Push this repo to GitHub (if you haven't already).
2. Go to [render.com/deploy](https://render.com/deploy) and paste your repo URL — or, once it's pushed, use a link of the form:
   `https://render.com/deploy?repo=https://github.com/<you>/<repo>`
3. Render reads `render.yaml` and shows you a preview of what it'll create: the `reelhouse` web service and the `reelhouse-db` database.
4. You'll be prompted for one value — `SEED_ADMIN_PASSWORD` — since that's marked `sync: false` in the Blueprint for security (it's not hardcoded anywhere). Choose your own admin password here.
5. Click **Deploy Blueprint**. Render builds the service, provisions the database, and — on this first deploy only — runs `npm run seed` automatically via `initialDeployHook`. Nothing wipes or reseeds on future deploys.
6. When it's done, open the web service's URL and sign in with `admin` / the password you chose.

**Free tier caveats worth knowing going in:**
- The web service sleeps after 15 min idle and takes 30–60s to wake back up on the next visit — fine for a demo, not for anything real-time.
- Render's free Postgres gets deleted after 30 days. If this needs to stick around, budget ~$7/mo for the paid Postgres tier before that clock runs out.
- Sessions use Express's in-memory store (see note above) — signed-in users get logged out whenever the free instance spins down from inactivity. Swap in `connect-pg-simple` if that's a problem for you.

### Manual setup (without the Blueprint)

If you'd rather click through the dashboard yourself, or use a different host:

1. Provision a Postgres database (Render, Railway, Supabase, Neon, RDS, etc.) and grab its connection string.
2. Set environment variables on your host:
   - `DATABASE_URL=postgres://...`
   - `SESSION_SECRET=<a long random string>`
   - `SEED_ADMIN_PASSWORD=<your choice>` (only needed the one time you run the seed script)
   - `NODE_ENV=production`
3. Deploy the app (any Node host works — Render, Railway, Fly.io, a VPS). Build command `npm install`, start command `npm start`.
4. Run `npm run seed` once against the deployed database — either via a one-off command on your host, or locally with `DATABASE_URL` pointed at the remote DB (e.g. Render's *External* connection string).
5. The app auto-creates its tables on boot (`ensureSchema`), so the seed step is really just for the starter catalog + admin account — you don't need to run migrations by hand.

No code changes are needed to switch backends — `server/db/index.js` picks the driver based on whether `DATABASE_URL` is set.

## Notes / next steps
- The admin panel is a separate static page (`/admin.html`) guarded by session + `is_admin`, not by anything at the network level — that's normal for this scale, but for a bigger project you'd also want rate limiting on `/api/auth/*` and CSRF protection on state-changing routes.
- "Play" is a placeholder toast — wiring up real video would mean licensing content, which is out of scope here.
- Password reset / email verification aren't implemented; this is a demo auth system, not a production-hardened one.

