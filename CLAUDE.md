# AJD — Interior Design Practice Manager (demo)

Single-file HTML/Tailwind(CDN)/vanilla-JS demo app for an interior design
practice: FF&E schedules, time tracking, a web clipper/moodboard, client
approvals, job-site coordination, and light invoicing. **Client-only — no
backend, no build step.** All state lives in the browser's `localStorage`.

- **App file:** [ajd.html](ajd.html) — everything (HTML/CSS/JS) in one file.
- **Run it:** `py -3 -m http.server 8420` from this directory, then open
  `http://localhost:8420/ajd.html`. (`.claude/launch.json` has an
  `ajd-static` preview config for the Browser tool.)
- **Reset to seed data:** `localStorage.clear()` then reload — `seed()`
  (~line 311) repopulates two demo projects (Fairlight Residence, Bondi Loft
  Fitout) with sample FF&E, time, clips, approvals, milestones, contacts, etc.
- **No git repo here yet** — this folder is not currently version-controlled.

## History

Rebuilt from scratch on 2026-09-06 (the original was an ephemeral scratchpad
file from an earlier session and no longer existed — see
`joinery-quoter`/`pm-quoter`/`tenon-quotr` sibling projects for unrelated
apps built from similar Builder/Critic-loop sessions). Since the rebuild it
has gone through **30 Assess → Implement → Verify loop iterations**, each
stage run by an independent Sonnet subagent so verification never trusted
the implementer's own claims. Iterations 1–20 were general improvements;
21–30 were explicitly scoped to **design and functionality** (visual
hierarchy, layout, substantive new features) per user request.

## Architecture

- Hash-based router (`route()`, ~line 439) with routes:
  - `#/` — dashboard (project grid)
  - `#/project/:id` — main project workspace, 9 tabs (see below)
  - `#/team` — cross-project workload aggregation (`renderTeam`)
  - `#/calendar` — cross-project deadlines feed (`renderCalendar`)
  - `#/trades/:id` — standalone job-site checklist view (no login, meant to
    be linked/QR'd to trades on site)
  - `#/portal/:id` — standalone client-facing portal (moodboard + approvals)
- State is one big object in `state` (module-level), persisted via
  `save()`/`load()` to `localStorage` key `ajd_state_v1`. Shape (all keyed by
  project id except `rates`, which is practice-wide):
  `projects`, `ffe`, `time`, `clips`, `approvals`, `tradesTasks`, `notes`,
  `activity`, `milestones`, `contacts`, `invoices`, `rates`.
- Brand palette: terracotta/ink, Fraunces (display) + Inter (body), CSS
  custom properties in `:root`.
- Fonts/Tailwind loaded from CDN — this app is a demo/prototype, not
  optimized for a fully offline environment (unlike the TH Cabinets project
  in a sibling repo, which deliberately vendors its fonts for that reason).

## Project workspace tabs (per `#/project/:id`)

1. **FF&E Schedule** — full CRUD, inline-editable status pill (colored
   dropdown), category chips (deterministic hash → palette), sortable
   category column, search, CSV export, per-room grouping with subtotals,
   budget-vs-actual summary + progress bar, optional linked Web Clipper
   reference thumbnail per item, optional expected-delivery-date with
   overdue-for-delivery flagging, supplier field backed by a `<datalist>` of
   Contacts (still accepts free text).
2. **Time Tracking** — full CRUD, CSV export, per-person bar-chart
   breakdown (colored via the same hash palette as avatars), optional
   practice-wide hourly rate per person → labor cost, folded into invoices.
3. **Web Clipper** — Pinterest-style masonry moodboard (natural aspect
   ratios, hover/focus-reveal metadata overlay, always-visible touch
   caption), broken-image fallback, live image preview in the save-clip
   modal, optional link from a clip to an FF&E item (sets that item's
   `clipId`), "show on client portal" flag per clip.
4. **Approvals** — 3-column Kanban board (Pending/Approved/Rejected),
   approve/reject from either the internal tab or the client portal (both
   write to the same object, decisions revisable either way at any time),
   full history/audit trail, "requested Xd ago" line, overdue badge at 5+
   days pending.
5. **Milestones** — horizontal visual timeline (connected nodes,
   terracotta+check/red-outline-overdue/neutral-outline-upcoming), click to
   toggle done, add/delete.
6. **Notes** — freeform notes, terracotta accent border, Today/Earlier
   grouping.
7. **Contacts** — supplier/trade directory, grouped into
   Supplier/Trade/Other via a keyword heuristic on the role field, colored
   role chips + initial avatars; feeds the FF&E supplier datalist and the
   Site Tasks assignee picker.
8. **Site Tasks** — grouped into Overdue (red)/Upcoming/Done (collapsed
   `<details>`), optional due date + assignee (from Contacts), completion
   progress bar; the exact same underlying array (`state.tradesTasks[id]`)
   backs the standalone `#/trades/:id` job-site view, kept in sync both
   directions.
9. **Activity** — reverse-chronological log of every mutation across the
   other tabs (`logActivity()`), auto-populated, not manually editable.

Also on the project detail page: a **"Next actions" digest** and a **hero
header** (project cover photo as a banner with a gradient scrim, overlaid
status tag, stat pills for Budget/FF&E Spent/Next-actions-count — clicking
Budget/Spent opens the budget-edit modal), a **"More ▾" dropdown** (Print
summary, Export invoice, Archive/Unarchive, Delete-when-archived).

## Cross-project views

- **Team** (`#/team`) — per-person aggregation across all non-archived
  projects: hours logged, labor cost (hours × `state.rates[name]`, or "no
  rate set"), open/overdue site-task counts, project links.
- **Deadlines** (`#/calendar`) — unifies FF&E `expectedDate` (excluding
  Delivered/Installed), milestone `targetDate` (excluding done), and site
  task `dueDate` (excluding done) across non-archived projects into
  Overdue/This week/Later groups.

## Other features

- **Invoice generator** (`exportInvoice`/`generateInvoice`) — FF&E line
  items + a Labor section (from Time Tracking hours × rates), markup %,
  auto-incrementing invoice numbers, opens a print-ready window.
- **Print summary** (`printProjectSummary`) — a simpler one-page snapshot
  (budget, approval counts, task counts).
- **Full backup/restore** — Export/Import buttons on the dashboard dump/load
  the entire `state` object as JSON (`exportAllData`/`handleImportFile`),
  destructive-overwrite confirmed, validates the file has a `projects` array
  before accepting it.
- **Global search** (`openGlobalSearch`/`runGlobalSearch`) — searches FF&E
  items, clips, approvals, and notes across all projects at once, excludes
  archived projects.
- **Dashboard** — search/filter, "Show archived" toggle, per-card budget
  progress bar + spend label, pending/overdue-approval badges, a rich
  first-run empty state (vs. a plain "no match" message when a filter/search
  yields zero results with projects still existing), project delete
  (permanent, only available once archived).
- **Mobile**: the project tab strip is horizontally scrollable
  (`#tab-strip`, `overflow-x-auto` + edge fades) rather than overflowing the
  page — this was a real bug found and fixed in iteration 29.

## Known non-issues / deliberate choices

- `designerDecide` and `clientDecide` both write to the same approval
  object; either side can revise a decision at any time (not gated on
  current status) — this was a deliberate fix in an early iteration after
  the client portal was initially found to lock up after one decision.
- Rates (`state.rates`) are practice-wide, not per-project — a person's
  hourly rate doesn't usually change per job.
- No auth anywhere (`#/trades/:id`, `#/portal/:id`, admin) — intentional for
  a demo; unlinked-by-obscurity only.

## Working conventions for this project

- Every change should go through the same loop this app was built with:
  **Assess** (an agent reads the current file and proposes ONE feature +
  ONE visual improvement, distinct from what already exists) → **Implement**
  (an agent makes the change and does a first-pass live verification) →
  **Verify** (a *different*, independent agent re-tests from scratch,
  doesn't trust the implementer's claims, fixes real bugs it finds).
- Prefer Sonnet subagents for all three stages unless told otherwise.
- After clearing `localStorage` to test fresh-seed behavior, remember that a
  **hash-only URL change does not reload the page** in this browser tooling
  — `state` stays in memory from before the clear. Always force a real
  `location.reload()` (or full `navigate()` to a non-hash URL first) before
  asserting what "fresh seed" looks like. This bit multiple verification
  passes during development.
- Keep everything in the single `ajd.html` file — no build step, no
  framework, by design (matches the pattern of other single-file apps in
  sibling project folders).
