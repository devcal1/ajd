# AJD Design Manager — Interior Design Practice Manager

A self-hosted Express/SQLite web app for an interior design practice: a
practice-wide product library, a project dashboard, and room-by-room FF&E
design documents with one-click PDF export. Built for **AJ Interiors**
(ajinteriors.com.au). Single-password auth (no multi-user accounts), one
SQLite file, packaged to run on Umbrel or any Docker host.

- **App code:** [app/](app) — Node/Express backend + static HTML/Tailwind-CDN/
  vanilla-JS frontend. No frontend build step; the backend has no build step
  either, just `npm install`.
- **Run it locally (no Docker):**
  ```
  cd app
  npm install
  APP_PASSWORD=changeme node src/index.js
  ```
  then open `http://localhost:3000`. `APP_PASSWORD` is only read on first
  boot, to seed the single password row in the database — see Auth below.
  `.claude/launch.json` has an `ajd-app` preview config for the Browser tool
  (set `APP_PASSWORD` in the environment before using it, or first-boot will
  throw — see Auth below).
- **Run it with Docker (dev/test compose):** `cd app && docker compose up
  --build` (reads `APP_PASSWORD`/`SESSION_SECRET` from the environment or
  defaults to `changeme`/`dev-secret`; see `app/docker-compose.yml`).
- **Git repo:** `https://github.com/devcal1/ajd.git`, branch `master`.
- **Retired prototype:** this project's first version was a client-only,
  no-backend, single-file demo (`ajd.html`, state in `localStorage`) built
  through two earlier development loops. It has been fully replaced by the
  app described here and moved to [archive/](archive) for reference only —
  see [archive/README.md](archive/README.md). Do not resume work on it or
  its old `ITERATE.md`/`ITERATION_LOG.md` process.

## History

Rebuilt from scratch on 2026-10-11 as a real backend, replacing the
`ajd.html` single-file demo's "no backend" model. Built in one session as six
sequential stages, each its own commit:

1. **Auth/session/DB scaffold** — `app/src/db.js`, `app/src/auth.js`,
   migrations table, `settings`/`sessions` tables.
2. **Product Library** — practice-wide item CRUD + image upload.
3. **Projects** — dashboard, CRUD, archive/delete.
4. **Rooms & selections** — the room-by-room FF&E design document.
5. **PDF export** — server-side, real PDFs via `puppeteer-core` driving a
   system/local Chromium.
6. **Umbrel packaging** — a standalone community app store under
   `umbrel-app-store/`, plus a GitHub Actions workflow that publishes the
   Docker image to GHCR.

That was the full planned stage order (Library → Projects → design
documents → PDF export → Umbrel packaging); it is now closed. Further work
is new scope, not a continuation of a backlog — there's no standing
iteration loop for this app the way there was for the retired `ajd.html`
(see archive/README.md).

## Architecture

- **Backend** ([app/src/](app/src)): plain Express (`index.js`), no
  framework beyond that. Route modules are mounted flat (no `/api` prefix
  baked into the router, each route declares its own full path):
  - `auth.js` (`routes/auth.js`) — `POST /login`, `POST /logout`, session
    cookie via `express-session` backed by a custom SQLite store
    (`sessionStore.js`) rather than an in-memory store, so sessions survive a
    restart.
  - `library.js` (`routes/library.js`) — `/api/library` CRUD, one flat table
    (`library_items`), optional image upload via `multer` (disk storage,
    8MB limit, image mimetypes only).
  - `projects.js` (`routes/projects.js`) — `/api/projects` CRUD, archive
    (soft-delete via `archived_at`) + hard delete (only allowed once
    archived), optional cover image upload.
  - `documents.js` (`routes/documents.js`) — nested resources per project:
    `document_rooms` (a room in that project's design document) each holding
    `document_selections` (an FF&E line item in that room, optionally linked
    back to a `library_items` row via `library_item_id` to prefill spec
    fields). `/api/projects/:projectId/rooms`,
    `/api/rooms/:id`, `/api/rooms/:roomId/selections`,
    `/api/selections/:id`.
  - `pdf.js` (`routes/pdf.js`) — `GET /api/projects/:id/document.pdf`:
    launches `puppeteer-core` against a local/system Chromium, navigates it
    (over loopback — `127.0.0.1:$PORT`, not the request's `Host` header, so
    it still works behind Umbrel's `app_proxy` or any other reverse proxy)
    to `/document-print.html?id=<id>`, forwards the request's session cookie
    so that print page can hit the authenticated JSON API itself, and
    streams back the rendered PDF.
  - All routes except `/login`, `/logout`, and the login page's own static
    assets (`/css`, `/js`) sit behind `requireAuth` (`auth.js`), mounted in
    `index.js` before the protected static/router mounts.
- **Database** (`app/src/db.js`): `node:sqlite` (Node's built-in SQLite,
  **requires Node ≥ 22.5** — see `engines` in `package.json`), WAL mode, FKs
  on. A small ordered `MIGRATIONS` array + a `_migrations` tracking table —
  each stage added exactly one migration (`001_settings` … `005_document_
  rooms_selections`) rather than editing earlier ones; add a new one the
  same way, never edit a migration that's already shipped. On first boot
  (no `settings` row yet), `ensureSettingsSeeded()` requires `APP_PASSWORD`
  in the environment and bcrypt-hashes it into `settings.password_hash` —
  after that the env var is never read again, so changing it does nothing
  post-seed (there's no "change password" flow yet; see Known gaps).
  `DATA_DIR` (default `app/data`, overridden to `/app/data` in Docker) holds
  the SQLite file + `uploads/`.
- **Frontend** (`app/public/`): static HTML pages, Tailwind via CDN
  (`cdn.tailwindcss.com` — a build step, not an offline asset, same
  tradeoff the old demo made), vanilla JS inline in each page, a shared
  `js/shared.js` (`api()` fetch wrapper that redirects to `/login.html` on
  401, `toast()`, `money()` formatter, `logout()`). One page per route:
  `index.html` (projects dashboard), `project.html?id=` (single project:
  details + room-by-room document editor), `library.html` (product
  library), `login.html`, `document-print.html?id=` (print-styled, no nav
  chrome — the page both the PDF route and a user's own browser "Preview
  document" link render).
- **Brand** (`app/public/css/brand.css`): ported directly from the retired
  `ajd.html`'s reskin — warm stone/greige grounds (`--paper`/`--paper-2`), a
  single dusty clay-taupe accent (`--terracotta*`), Libre Baskerville for
  `.font-display` headings, Inter for everything else, fully pill-shaped
  buttons. See archive/README.md if the real ajinteriors.com.au brand ever
  needs re-checking — this file is a port, not a fresh review.
- **Packaging**: `app/Dockerfile` installs system Chromium (so Puppeteer
  doesn't download its own, keeping the image smaller) and sets
  `PUPPETEER_EXECUTABLE_PATH`. `app/docker-compose.yml` is the **local
  dev/test** compose file (builds from `app/Dockerfile` directly).
  `umbrel-app-store/` is a separate, **standalone Umbrel community app
  store** (its own `umbrel-app-store.yml` + `ajd-design-manager/umbrel-
  app.yml` + `ajd-design-manager/docker-compose.yml`) — point Umbrel's "Add
  community app store" at this repo's URL + `/umbrel-app-store`. That
  compose file runs behind Umbrel's `app_proxy` convention and pulls a
  **prebuilt** `ghcr.io/devcal1/ajd-design-manager:<version>` image rather
  than building on-device; `.github/workflows/docker-publish.yml` builds and
  publishes that image to GHCR when a tag matching `app-vX.Y.Z` is pushed
  (see `umbrel-app-store/README.md` for the exact release steps — bump
  `umbrel-app.yml`'s `version:` and the compose file's image tag together
  with the git tag, and make the GHCR package public after the first push,
  since Umbrel pulls anonymously).

## Auth

Single shared password for the whole practice, no per-user accounts.
- First boot with no `settings` row: `APP_PASSWORD` env var is required and
  gets bcrypt-hashed into the one `settings` row. Missing it throws at
  startup (`db.js`'s `ensureSettingsSeeded`).
- `POST /login` with `{ password }` → `checkPassword` compares against that
  hash, sets `req.session.authed = true` on success.
- `requireAuth` middleware (mounted before every protected route) checks
  `req.session.authed`; JSON API paths (`/api/*`) get a 401, everything else
  gets redirected to `/login.html`.
- Sessions persist in the `sessions` SQLite table (`sessionStore.js`), 30-day
  cookie, `SESSION_SECRET` env var (defaults to a dev placeholder — **set a
  real one outside local dev**, including in the Umbrel compose file where
  it's wired to the per-install `$APP_SEED`).

## Data model

Five tables beyond `settings`/`sessions`/`_migrations`:
- `library_items` — one flat table, the practice-wide Product Library.
  title/category/supplier/sku/dimensions/finish/cost/notes/image_path.
- `projects` — name/client_name/status (`active`/`on hold`/`complete`)/
  budget/notes/cover_image_path/archived_at.
- `document_rooms` — `project_id` FK (`ON DELETE CASCADE`), name. One
  project has many rooms.
- `document_selections` — `room_id` FK (`ON DELETE CASCADE`), optional
  `library_item_id` FK (`ON DELETE SET NULL` — deleting a library item
  un-links but doesn't delete selections built from it), same spec fields as
  `library_items` plus qty/status (`proposed`/`approved`/`rejected`)/
  image_path. One room has many selections — this is the actual line-item
  content of the room-by-room FF&E design document.

Uploaded images (library item photos, project cover photos, selection
photos) are all stored as files under `DATA_DIR/uploads/`, referenced by
filename only (`image_path`/`cover_image_path` columns), served via
`/uploads/<filename>` (static, but still behind `requireAuth` since it's
mounted after that middleware in `index.js`).

## Features, by page

- **Projects dashboard** (`index.html`) — grid of project cards, search by
  name/client, archived-projects toggle (hidden by default), create/edit via
  modal (name, client, status, budget, notes, cover image).
- **Project detail** (`project.html?id=`) — project fields + cover image
  editing; the room-by-room design document editor: add/rename/delete
  rooms, add/edit/delete selections within a room (title, category,
  supplier, SKU, dimensions, finish, cost, qty, status, notes, image), an
  "Import from library" field that prefills a new selection's spec fields
  from an existing Product Library item (`library_item_id` on the resulting
  row links back to it); "Preview document" (opens `document-print.html` in
  a new tab) and "Download PDF" actions.
- **Document print/PDF view** (`document-print.html?id=`) — print-styled,
  nav-free rendering of a project's full room-by-room document; this exact
  page is what `document.pdf` screenshots server-side, so changes here
  affect both the in-browser preview and the downloaded PDF identically.
- **Product Library** (`library.html`) — practice-wide item CRUD + image
  upload, search by title/category/supplier; items here are what "Import
  from library" on a project pulls from, but importing copies spec fields
  into a new `document_selections` row rather than referencing the library
  item live (editing a library item after import does not change already-
  imported selections).
- **Login** (`login.html`) — password-only form, posts to `/login`.

## Known gaps / deliberate choices

- No "change password" flow — `APP_PASSWORD` only matters on first boot,
  there's no UI or route to rotate it afterward (would need a direct DB edit
  or a wipe + reseed today).
- No per-user accounts, no roles — one shared password for the whole
  practice, matching the old demo's "no auth" stance but at least gated
  behind something now.
- No client-facing portal, procurement/lead-time tracking, approvals
  workflow, task boards, time tracking, or web clipper/moodboard yet — the
  retired `ajd.html` prototype had all of these (see archive/README.md);
  none have been rebuilt on the new backend. The current app covers the
  Library → Projects → room-by-room document → PDF slice only.
- `app/public/css/brand.css` is a direct port of the old demo's brand
  styling, not a fresh review of ajinteriors.com.au — re-check the live site
  directly before making further branding decisions, same as the old
  CLAUDE.md used to advise for `ajd.html`.
- PDF generation requires a locally reachable Chromium/Chrome: the Docker
  image installs one; a bare local dev run falls back to probing common
  Chrome/Edge/Chromium install paths per-OS (`routes/pdf.js`'s
  `LOCAL_DEV_CANDIDATES`) or an explicit `PUPPETEER_EXECUTABLE_PATH`. If
  none is found, the PDF route 500s with a message pointing at the browser's
  own Print dialog on `document-print.html` as a fallback.

## Working conventions for this project

- No standing iteration loop is active for `app/` the way `ITERATE.md`
  described for the retired `ajd.html` — treat new work as direct, scoped
  requests unless the user explicitly asks to set up a loop for this app.
- Keep the migrations array append-only (`app/src/db.js`): add a new
  `{ id, up() }` entry for any schema change, never edit a migration that's
  already shipped/applied.
- `app/docker-compose.yml` (local dev/test, builds from source) and
  `umbrel-app-store/ajd-design-manager/docker-compose.yml` (Umbrel
  packaging, pulls a prebuilt GHCR image) are deliberately separate files
  with different conventions — don't merge them or assume one supersedes
  the other.
- `document-print.html` is shared by both the human "Preview document" link
  and the server-side PDF renderer (`routes/pdf.js` screenshots that exact
  URL) — a change there changes both outputs identically; there's no
  separate PDF-only template to keep in sync.
