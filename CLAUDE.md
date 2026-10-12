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
  then open `http://localhost:3000`. `APP_PASSWORD` seeds the single password
  row on first boot, and keeps overriding it until a password is chosen in
  Settings — see Auth below.
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
6. **Umbrel packaging** — originally a store folder in this repo, then moved
   (2026-10-12) into the Tenon store, `devcal1/tenon-umbrel-store`, as the
   `tenon-ajd-design-manager` app (see Packaging below); plus a GitHub Actions
   workflow that publishes the Docker image to GHCR.

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
  - `backups.js` (`routes/backups.js`) — `GET /api/backups` (list),
    `POST /api/backups/run` (trigger one immediately). The actual backup
    logic lives in `app/src/backup.js`, not in a route file — see Backups
    below.
  - `password.js` (`routes/password.js`) — `POST /api/password`, the
    change-password endpoint behind login (see Auth).
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
  each change added exactly one migration (`001_settings` … `006_password_
  source`) rather than editing earlier ones; add a new one the
  same way, never edit a migration that's already shipped. On first boot
  (no `settings` row yet), `ensureSettingsSeeded()` requires `APP_PASSWORD`
  in the environment and bcrypt-hashes it into `settings.password_hash`.
  `settings.password_source` is `'env'` until the password is changed in the
  app, then `'user'`; see Auth below for what that does.
  `DATA_DIR` (default `app/data`, overridden to `/app/data` in Docker) holds
  the SQLite file + `uploads/`.
- **Frontend** (`app/public/`): static HTML pages, Tailwind via CDN
  (`cdn.tailwindcss.com` — a build step, not an offline asset, same
  tradeoff the old demo made), vanilla JS inline in each page, a shared
  `js/shared.js` (`api()` fetch wrapper that redirects to `/login.html` on
  401, `toast()`, `money()` formatter, `logout()`). One page per route:
  `index.html` (projects dashboard), `project.html?id=` (single project:
  details + room-by-room document editor), `library.html` (product
  library), `settings.html` (change password — see Auth — and backups — see
  Backups), `login.html`,
  `document-print.html?id=` (print-styled, no nav chrome — the page both the
  PDF route and a user's own browser "Preview document" link render). Every
  authenticated page's header carries a small, deliberately low-contrast
  "⚙" link to `settings.html` (plain unicode gear, `opacity:.6`, no label,
  no pill background unlike the other nav items) — settings is reachable
  from anywhere but isn't presented as a primary section.
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
  **The Umbrel packaging does not live in this repo.** It is the
  `tenon-ajd-design-manager` app (`umbrel-app.yml`, `docker-compose.yml`,
  `icon.svg`, `data/`) in the public Tenon community app store,
  **`https://github.com/devcal1/tenon-umbrel-store`** (store id `tenon`, port
  4934), which Umbrel adds as a store by that repo URL — Umbrel cannot add a
  store from a subfolder of another repo, and it requires every app id to be
  prefixed with the store id, which is why a first attempt at keeping a store
  folder in this repo 404'd. That compose file runs behind Umbrel's `app_proxy`
  (Umbrel's own login off, since the app has its own password), and pulls a
  **prebuilt** `ghcr.io/devcal1/ajd-design-manager:<version>@sha256:<digest>`
  image rather than building on-device. `.github/workflows/docker-publish.yml`
  builds and publishes that image to GHCR when a tag matching `app-vX.Y.Z` is
  pushed (the package is public, since Umbrel pulls anonymously). **Releasing:**
  push the tag here, read the new manifest digest from the registry, then in
  the Tenon store paste the `image:` line (tag + digest) and bump `version:` in
  `tenon-ajd-design-manager/umbrel-app.yml` to match — the store's README has
  the exact steps. The app's id (`tenon-ajd-design-manager`) is permanent:
  Umbrel treats a change as uninstall-and-reinstall, which deletes the data
  directory. An earlier `umbrel-app-store/` folder in this repo was removed on
  2026-10-12; don't recreate a store inside this repo.

## Auth

Single shared password for the whole practice, no per-user accounts.
- First boot with no `settings` row: `APP_PASSWORD` env var is required and
  gets bcrypt-hashed into the one `settings` row. Missing it throws at
  startup (`db.js`'s `ensureSettingsSeeded`).
- **Two password sources.** While `settings.password_source` is `'env'` (the
  password has never been changed in the app), `APP_PASSWORD` stays the source
  of truth: at every start `ensureSettingsSeeded()` re-hashes it into the row
  if it no longer matches. That is what lets a corrected or rotated value in
  the environment take effect instead of leaving the app locked behind a
  stale hash (this happened on the first Umbrel install: the compose file fed
  the container `$APP_SEED`, but Umbrel displays a different generated value,
  `$APP_PASSWORD`, when `deterministicPassword: true`). Once someone sets a
  password in Settings, `POST /api/password` (`routes/password.js`) stores it
  and flips the source to `'user'`, after which the environment is never read
  again — updates and restarts cannot overwrite a chosen password. It needs the
  current password, requires 8+ characters, and signs every other browser out
  (deletes the other `sessions` rows). A wrong current password returns 400,
  not 401, because `shared.js`'s `api()` bounces any 401 to the login page.
- There is no "forgot password" path for a `'user'` password: with no email or
  second factor to verify against, recovery means editing the database
  (`UPDATE settings SET password_hash=…, password_source='env'`) or restoring a
  backup taken before the change (a restore also restores the old password).
- `POST /login` with `{ password }` → `checkPassword` compares against that
  hash, sets `req.session.authed = true` on success.
- `requireAuth` middleware (mounted before every protected route) checks
  `req.session.authed`; JSON API paths (`/api/*`) get a 401, everything else
  gets redirected to `/login.html`.
- Sessions persist in the `sessions` SQLite table (`sessionStore.js`), 30-day
  cookie, `SESSION_SECRET` env var (defaults to a dev placeholder — **set a
  real one outside local dev**, including in the Umbrel compose file where
  it's wired to the per-install `$APP_SEED`).

## Backups

`app/src/backup.js` runs fully automatically — no setup step, nothing for
the designer to configure or remember. It starts itself from `index.js`
(`startSchedule()`) right after the HTTP server comes up. Each run
(`runBackup()`):
1. `VACUUM INTO`s a consistent point-in-time copy of the live SQLite DB (safe
   under WAL mode and while the app is serving requests — unlike a raw file
   copy, which could grab the DB mid-write) into a new timestamped directory.
2. Copies the `uploads/` directory alongside it.
3. Prunes old backups beyond `BACKUP_RETENTION` (default 14), oldest first.

**Scheduling**: nightly at a fixed local hour (`BACKUP_HOUR`, default 2am),
not a 24h interval anchored to whenever the container last booted —
`scheduleNext()` recomputes "ms until the next `BACKUP_HOUR`" with a
recursive `setTimeout` each time, so it lands at the same predictable,
low-traffic time every night and doesn't drift across restarts or DST. `TZ`
(set in both compose files, default `Australia/Sydney` — change it if the
practice is elsewhere) controls what "night" means; the Dockerfile installs
`tzdata` so that env var actually takes effect in the container instead of
silently staying on UTC. A brand-new install with zero backups also gets one
quick backup ~60s after first boot, so it isn't left exposed for up to a day
waiting for the first nightly run.

Backups land under `DATA_DIR/backups/<ISO-timestamp>/` — **inside** the same
directory both `app/docker-compose.yml` and the Umbrel compose file already
mount as a persistent volume (`${APP_DATA_DIR}/data` on Umbrel). That's the
whole integration with Umbrel: as long as Umbrel's own backup feature is
configured to include this app's data directory, these scheduled snapshots
get swept up in it automatically — there's no Umbrel-specific API call here,
just "write backups where the volume already is."

- `GET /api/backups` lists existing backups (name + size); `POST
  /api/backups/run` triggers one immediately (used by `settings.html`'s
  "Back up now" button, mostly for manual/pre-change snapshots — the nightly
  schedule needs no interaction from the designer at all).
- **Restore**: `POST /api/backups/:name/restore` (`restoreBackup()` in
  `backup.js`) overwrites the live DB + uploads with a chosen backup's copies,
  then deliberately `process.exit(1)`s. There's no safe way to hot-swap the
  SQLite file under the one `node:sqlite` connection every route shares
  while the process keeps running, so a restart is the mechanism, not a bug
  — both compose files' restart policies (`unless-stopped` / `on-failure`)
  bring the container straight back up reading the restored files. The route
  validates the backup exists first (`backupExists()`) and defers the actual
  `db.close()`/file-swap to the response's `finish` event, not inline in the
  handler — doing it inline raced `restoreBackup()`'s `db.close()` against
  express-session's own post-response write to the sessions table.
- **UI**: `app/public/settings.html` — not linked from the main nav, only
  from a small low-contrast "⚙" link in each page's header (see Frontend
  above). Shows last-backup status, a "Back up now" button, and every kept
  backup listed by human-readable date (`parseBackupName()` turns the
  ISO-ish directory name into e.g. "Sunday, 11 October 2026" + time), each
  with its own "Restore" button — since backups are one-per-night, picking a
  row is effectively picking a date. A `confirm()` warns what's lost before
  calling the route, then a "Restoring..." overlay polls `/login.html`
  until the app is back up and redirects there.
- Backup/restore are the only destructive admin actions without a dedicated
  confirmation *page* (just a native `confirm()`) — deliberately minimal
  given this is a single-password, single-practice app with no one else to
  protect against.
- There's no off-box/offsite copy — these are *local* backups only, per the
  original request; pairing this with Umbrel's own external-drive or remote
  backup target is what makes it offsite, not anything in this app.

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

## Library change warning

Migration `007_selection_library_snapshot` adds `document_selections.library_snapshot`
(JSON of the linked library item's title/category/supplier/sku/dimensions/finish/cost/image
as of the last import or refresh; existing linked rows were snapshotted from the library's
current values). `routes/documents.js` compares it with the live library item and adds
`libraryStatus` (`none`/`current`/`changed`/`removed`) and `libraryDiff` to each serialized
selection. `project.html` shows a "Library updated" / "Library item deleted" badge opening a
prompt that lists each field's before/after; `POST /api/selections/:id/library-sync`
(`update` / `keep` / `dismiss`) resolves it. Update copies spec fields and photo (file is
copied) but never qty/status/notes. The badge is not shown in `document-print.html`.

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

- Password recovery: the password can be changed in Settings, but there is no
  "forgot password" flow (see Auth). Login also has no rate limiting.
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

## Backlog — requested by the owner, deliberately not started

Flagged 2026-10-12 to action later. None of these is in progress; don't treat
them as scheduled. Notes under each are starting points found while reading the
code, not decisions.

1. ~~Version control per project document~~ — **built 2026-10-12**, committed
   locally, not yet pushed/released. Migration `009_document_revisions`;
   `routes/revisions.js`. "Issue new revision" on `project.html` freezes the document
   as a JSON snapshot (`document_revisions.snapshot`: project name/client/display
   settings + rooms + selections) labelled Rev A, B... (`seq` per project, never
   reused). Selection photos are *copied* into `uploads/` so the revision is immune to
   later edits/deletes; they are removed when the revision or project is deleted.
   Revisions can be viewed (`document-print.html?id=&revision=`), exported
   (`document.pdf?revision=`), compared with the live document (items matched by room +
   title) and restored. Restore replaces the live rooms/selections and first saves the
   current document as its own revision, so it is undoable; library links are not
   restored (restored selections are plain copies). Revisions are not touched by
   library-sync. All four owner-requested backlog items are now built.
2. ~~Per-project PDF display settings~~ — **built 2026-10-12**, committed locally,
   not yet pushed/released. Migration `008_project_pdf_settings` adds
   `projects.pdf_settings` (JSON; NULL = defaults). Options: show costs/totals,
   images, approval column, category/supplier/SKU line, header text, default
   grouping (room/supplier). `routes/projects.js` normalizes them
   (`normalizePdfSettings`; a PUT without the field keeps the stored value, so the
   dashboard's edit form can't reset them), `project.html`'s Edit dialog edits them,
   and `document-print.html` reads `project.pdfSettings` so preview and PDF follow
   alike. `showSupplierColumn` (default on) adds a Supplier column in the room-grouped view only. A `?group=` URL param overrides the grouping setting.
3. ~~Group items by supplier~~ — **built 2026-10-12**, committed locally, not yet
   pushed/released. `document-print.html?id=&group=supplier` (and
   `/api/projects/:id/document.pdf?group=supplier`, linked from `project.html` as
   "Preview by supplier" / "PDF by supplier") regroups the same document by supplier;
   suppliers are matched ignoring case, spacing and punctuation and labelled with their
   most common spelling; items with none go last under "No supplier". No schema change.
4. ~~Warn when an item changed in the library after import~~ — **built
   2026-10-12**, committed locally, not yet pushed/released. See "Library change
   warning" above.

## Working conventions for this project

- Links inside the app open in the same tab (no `target="_blank"`) — the owner asked for this.

- No standing iteration loop is active for `app/` the way `ITERATE.md`
  described for the retired `ajd.html` — treat new work as direct, scoped
  requests unless the user explicitly asks to set up a loop for this app.
- Keep the migrations array append-only (`app/src/db.js`): add a new
  `{ id, up() }` entry for any schema change, never edit a migration that's
  already shipped/applied.
- `app/docker-compose.yml` (local dev/test, builds from source) and
  `tenon-ajd-design-manager/docker-compose.yml` in the Tenon store (Umbrel
  packaging, pulls a prebuilt GHCR image) are deliberately separate files
  with different conventions — don't merge them or assume one supersedes
  the other.
- `document-print.html` is shared by both the human "Preview document" link
  and the server-side PDF renderer (`routes/pdf.js` screenshots that exact
  URL) — a change there changes both outputs identically; there's no
  separate PDF-only template to keep in sync.
