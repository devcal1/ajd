# AJD Design Manager — Umbrel packaging

This directory is a standalone [Umbrel community app
store](https://github.com/getumbrel/umbrel-community-app-store) — add it to
an Umbrel via **Settings → App Store → Add community app store** with this
repo's URL plus `/umbrel-app-store` (Umbrel clones community stores from a
path inside a larger repo the same way it clones a dedicated store repo).

## What's here

- `umbrel-app-store.yml` — the store's own manifest (id + display name).
- `ajd-design-manager/umbrel-app.yml` — the app's manifest (name, tagline,
  description, port, and `deterministicPassword`/`defaultPassword` wired to
  Umbrel's per-install `$APP_SEED` so every install gets its own password
  instead of defaulting to `changeme`).
- `ajd-design-manager/docker-compose.yml` — the compose file Umbrel actually
  runs: an `app_proxy` service (Umbrel's reverse-proxy/TLS convention) in
  front of `web`, which pulls a **prebuilt** image rather than building
  on-device (Umbrel doesn't build images itself).

This is separate from [`app/docker-compose.yml`](../app/docker-compose.yml),
which is a local dev/test compose file that builds the image directly from
[`app/Dockerfile`](../app/Dockerfile).

## Publishing the image

`ajd-design-manager/docker-compose.yml` references
`ghcr.io/devcal1/ajd-design-manager:<version>`. Pushing a tag of the form
`app-vX.Y.Z` runs
[`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml),
which builds `app/Dockerfile` and pushes that version (plus `:latest`) to
GHCR. Bump the `version:` in `umbrel-app.yml` and the image tag in
`docker-compose.yml` together with the git tag, e.g.:

```bash
git tag app-v1.0.0
git push origin app-v1.0.0
```

GHCR packages are private by default — after the first push, make
`ajd-design-manager` public under the repo owner's GitHub Packages settings
so Umbrel (which pulls anonymously) can fetch it.

## Backups

The app backs itself up automatically, every night, with no setup step —
nothing to schedule or remember. It snapshots the DB + uploads at
`BACKUP_HOUR` local time (default 2am, set `TZ` to the practice's own
timezone) and prunes to the last `BACKUP_RETENTION` copies (see
[CLAUDE.md](../CLAUDE.md#backups)), into `data/backups`, which is inside the
`${APP_DATA_DIR}/data` volume this compose file already mounts. A "Restore
a backup" option lives on the app's own dashboard for rolling back to one of
those snapshots.

For those nightly snapshots to survive beyond this one Umbrel install, point
Umbrel's own backup feature (Settings → Backups, or an external-drive/remote
target) at this app's data directory — the app writes backups in a place
Umbrel can already see, but doesn't call any Umbrel backup API itself.
