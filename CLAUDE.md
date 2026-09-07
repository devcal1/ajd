# AJD — Interior Design Practice Manager (demo, built for AJ Design)

Single-file HTML/Tailwind(CDN)/vanilla-JS demo app for an interior design
practice: FF&E specification/scheduling, procurement/lead-time tracking,
client collaboration (approvals + comments), and custom task boards, aimed at
the site vision of a "specialized project management and specification
software" for **AJ Design** (ajinteriors.com.au). **Client-only — no backend,
no build step.** All state lives in the browser's `localStorage`.

- **App file:** [ajd.html](ajd.html) — everything (HTML/CSS/JS) in one file.
- **Run it:** `py -3 -m http.server 8420` from this directory, then open
  `http://localhost:8420/ajd.html`. (`.claude/launch.json` has an
  `ajd-static` preview config for the Browser tool.)
- **Reset to seed data:** `localStorage.clear()` then a REAL page reload
  (`location.reload()`, not just a hash change — see gotcha below) —
  `seed()` repopulates two demo projects (Fairlight Residence, Bondi Loft
  Fitout) with sample FF&E, time, clips, approvals, milestones, contacts, a
  board, etc.
- **Git repo**: `https://github.com/devcal1/ajd.git`, branch `master`.
  [ITERATE.md](ITERATE.md) is the standing vision-driven development process;
  [ITERATION_LOG.md](ITERATION_LOG.md) is the one-line-per-iteration changelog
  for that process (read it before proposing new work, so nothing repeats).

## History

Rebuilt from scratch on 2026-09-06 (the original was an ephemeral scratchpad
file from an earlier session and no longer existed). Since the rebuild it has
gone through:
- **30 general Assess → Implement → Verify iterations** (2026-09-06),
  iterations 1–20 broad improvements, 21–30 explicitly scoped to design and
  functionality.
- **22 vision-driven Analyze → Plan → Execute → Bugfix iterations**
  (2026-09-06/07, per [ITERATE.md](ITERATE.md)), each stage run by an
  independent Sonnet subagent so verification never trusted the implementer's
  own claims, explicitly targeting gaps against the site vision (FF&E
  scheduling, procurement/lead-times, client approval dashboards, custom task
  boards, spreadsheet-elimination/error-reduction). Full one-line-per-iteration
  history in [ITERATION_LOG.md](ITERATION_LOG.md). This formal loop concluded
  at iteration 22.
- **A one-off ad hoc session (2026-09-07, this session, direct user requests
  rather than the ITERATE.md loop)** that: fixed a batch of real bugs found by
  manual QA (modal system had no scroll handling and clipped its own Save/
  Cancel buttons on short viewports; the project tab-strip's edge-fade
  permanently hid the first tab label; the mobile header nav and project-hero
  buttons overlapped their neighbors); redesigned the project tab strip from a
  single horizontally-scrolling row into wrapping pill clusters so every tab
  is reachable with no scrolling at any width; **reskinned the entire app's
  visual identity to match the actual designer's site, ajinteriors.com.au**
  (see Brand identity below) after reviewing it directly; and added a
  **practice-wide Product Library** built on top of the Web Clipper (see
  Product Library below) plus a **client/builder FF&E audience split** (see
  FF&E Schedule below). No ITERATION_LOG.md entries were added for this
  session — that log is scoped to the closed ITERATE.md loop specifically;
  see `git log` for the specifics of this session's five commits instead.

## Architecture

- Hash-based router (`route()`) with routes:
  - `#/` — dashboard (project grid + a "Needs attention" strip aggregating
    overdue approvals/deadlines/procurement and unread client comments)
  - `#/project/:id` — main project workspace, 11 tabs grouped into 4 visual
    clusters (see below)
  - `#/team` — cross-project workload aggregation (`renderTeam`)
  - `#/calendar` — cross-project deadlines feed (`renderCalendar`)
  - `#/procurement` — cross-project on-order/delivered/ready-to-order view
    (`renderProcurement`)
  - `#/approvals` — cross-project approvals overview (`renderApprovalsOverview`)
  - `#/budget` — cross-project budget/spend overview (`renderBudget`)
  - `#/boards` — cross-project task-board overview (`renderBoardOverview`)
  - `#/library` — cross-project **Product Library** (`renderLibrary`) — see
    Product Library below
  - `#/trades/:id` — standalone job-site view (no login, meant to be linked/
    QR'd to trades on site): site-task checklist **plus** a builder-facing
    FF&E "Materials & FF&E" list (see FF&E Schedule below)
  - `#/portal/:id` — standalone client-facing portal/dashboard
- State is one big object in `state` (module-level), persisted via
  `save()`/`load()` to `localStorage` key `ajd_state_v1`. Shape (all keyed by
  project id except `rates`/`poCounters`, which are practice/supplier-wide):
  `projects`, `ffe`, `time`, `clips`, `approvals`, `tradesTasks`, `notes`,
  `activity`, `milestones`, `contacts`, `invoices`, `rates`, `boards`,
  `comments`, `lastSeenByStaff`, `poCounters`. `clips` also holds one extra,
  non-project key, `state.clips[LIBRARY_BUCKET]` (`LIBRARY_BUCKET = '_library'`)
  — products added straight to the Product Library with no project attached;
  see Product Library below.
- **Brand identity** (reskinned 2026-09-07 to match the actual designer's
  site, ajinteriors.com.au, reviewed directly rather than guessed): warm
  stone/greige grounds (`--paper`/`--paper-2`) with a single dusty clay-taupe
  accent (`--terracotta`/`--terracotta-dark`/`--terracotta-soft` — CSS
  variable *names* kept as-is from the original terracotta palette, only
  their hex *values* changed, so every existing usage picked up the new
  palette for free); Libre Baskerville for all `.font-display` headings,
  Inter kept for dense tables/forms; buttons and the tab-strip pill groups
  are fully pill-shaped (`border-radius:999px`); the top nav underlines
  whichever section is active (`updateNavActive()`, called from `route()`);
  the client portal opens with a white hero band and a curved SVG
  wave-divider easing into the greige body, echoing that site's own
  section-transition motif, and reads "AJ Interiors" (not the internal
  tool's "AJD" initials) since that's the one surface real clients see.
- Fonts/Tailwind loaded from CDN — this app is a demo/prototype, not
  optimized for a fully offline environment.

## Project workspace tabs (per `#/project/:id`)

The tab strip is grouped into 4 labeled pill clusters (`.tab-strip-group`)
that **wrap onto multiple lines** as the viewport narrows, rather than
scrolling horizontally — every tab stays reachable with no scrolling at any
width, desktop or mobile (redesigned 2026-09-07; `data-tab`/`setTab`/
`activeTab` mechanics underneath are unchanged, only the container layout
and the `.tab-active`/`.tab-inactive` visual style, now a filled pill instead
of an underline):

**Plan** — FF&E Schedule, Milestones, Board, Site Tasks
**Collaborate** — Approvals, Client Comments, Notes, Web Clipper
**Track** — Time Tracking, Activity
**People** — Contacts

1. **FF&E Schedule** — full CRUD, inline-editable status pill, category
   chips, sortable category column, search, CSV export, per-room grouping
   with subtotals, budget-vs-actual summary + progress bar, optional linked
   Web Clipper thumbnail, expected-delivery-date with overdue flagging,
   supplier `<datalist>` backed by Contacts, **specification fields** (SKU,
   dimensions, finish, product/spec-sheet URL — shown via an expandable
   caret row, not extra columns), **procurement auto-tracking**
   (`orderDate`/`deliveredDate` auto-stamped on status transitions), an
   **approval-status badge** per item (Pending/✓ Approved/Changes
   requested/⚠ Spec changed since approval — the last one via spec-drift
   detection comparing the item's current spec against what was snapshotted
   at approval time), and a **two-audience visibility split**: independent
   `forClient`/`showToTrade` opt-in flags per item, each rendered as a small
   Client/Builder badge next to the item name. `forClient` items appear on
   the client portal's Product Schedule (aesthetic fields only — never
   cost/qty/supplier/SKU); `showToTrade` items appear on the job-site view's
   new "Materials & FF&E" section (installation fields — room/category/
   supplier/SKU/dimensions/qty/status — never cost, the same
   never-show-commercial-figures rule as the client side, just for a
   different reason). The same row can be shown to neither, either, or both
   audiences.
2. **Time Tracking** — full CRUD, CSV export, per-person bar-chart
   breakdown, optional practice-wide hourly rate per person → labor cost,
   folded into invoices and the cross-project Budget view.
3. **Web Clipper** — Pinterest-style masonry moodboard, broken-image
   fallback, live image preview, full CRUD (add/**edit**/**delete** — edit
   and delete added 2026-09-07, previously add-only), optional link from a
   clip to an FF&E item OR to an approval (visual reference on what's being
   approved), "show on client moodboard" flag per clip. Clips now also carry
   **full product-spec fields** (category, supplier, SKU, dimensions,
   finish, cost, notes — all optional, mirroring the FF&E spec fields) —
   every clip saved here is simultaneously a moodboard pin AND a record in
   the practice-wide **Product Library** (`#/library`, see below); a small
   "Import" action on each clip card copies it straight into this or any
   other project's FF&E schedule without leaving the tab.
4. **Approvals** — 3-column Kanban (Pending/Approved/Rejected).
   Approve/reject from either the internal tab or client portal (shared
   object, revisable either way at any time) opens a small modal requiring a
   **reason when rejecting** (optional when approving); full decision
   history (status + actor + date + comment) renders as a lightweight
   conversation log on both sides. Optionally links to one FF&E item, which
   snapshots that item's spec at approval time for drift detection.
5. **Milestones** — horizontal visual timeline (connected nodes,
   terracotta+check/red-outline-overdue/neutral-outline-upcoming). The
   node-rendering logic is a shared `milestoneTimelineHtml(rows, opts)`
   helper — `{interactive:true}` for this tab (toggle/delete), `{interactive:
   false}` for the read-only copy on the client portal.
6. **Client Comments** — a shared, project-wide discussion thread (distinct
   from Notes, which stays internal-only) visible on both this tab and a
   portal section. Client posters are prompted once for a name (stored
   *globally* in `localStorage`, not per-project — one portal link is one
   person). Unread client comments show a badge on this tab button and on
   the dashboard card, cleared only by actually opening this tab (not by any
   other project-page render).
7. **Notes** — freeform, internal-only, terracotta accent border,
   Today/Earlier grouping.
8. **Contacts** — supplier/trade directory, grouped into
   Supplier/Trade/Other via a keyword heuristic on the role field; feeds the
   FF&E supplier datalist and the Site Tasks/Board assignee pickers.
9. **Site Tasks** — grouped into Overdue (red)/Upcoming/Done (collapsed
   `<details>`), optional due date + assignee, completion progress bar; the
   same underlying array (`state.tradesTasks[id]`) backs the standalone
   `#/trades/:id` job-site view, kept in sync both directions.
10. **Board** — user-defined Kanban columns + cards (add/delete columns,
    delete-guarded if non-empty), **native HTML5 drag-and-drop** to move
    cards between/within columns (a `<select>` dropdown is kept as an
    accessible/no-DnD fallback). Cards support an optional due date +
    assignee; overdue cards (not in the board's terminal column) feed the
    Next Actions digest, the Deadlines calendar, and the Team workload view
    the same way Site Tasks do.
11. **Activity** — reverse-chronological log of every mutation across the
    other tabs, auto-populated, not manually editable.

Also on the project detail page: a **photo hero header** (cover image,
gradient scrim, overlaid status tag), **stat pills** (Budget, FF&E Spent,
Next-actions-count — clicking Budget/Spent opens the budget-edit modal), a
**"Next actions" digest**, and a **"More ▾" dropdown** (Print summary, Export
invoice, Archive/Unarchive, Delete-when-archived).

## Cross-project views

- **Team** (`#/team`) — per-person aggregation: hours logged, labor cost, and
  open/overdue task counts folding together BOTH Site Tasks and Board cards
  assigned to that person, project links.
- **Deadlines** (`#/calendar`) — unifies FF&E `expectedDate`, milestone
  `targetDate`, site task `dueDate`, AND board card `dueDate` into
  Overdue/This week/Later groups.
- **Procurement** (`#/procurement`) — three sections: **Ready to order**
  (Specified-status FF&E items grouped by supplier, with a "Generate PO"
  action that prints a purchase order and transitions the group to Ordered),
  **On order** (with a hard "Overdue" flag when an explicit expected date
  has passed, or a softer amber "Predicted late (avg Nd)" warning when the
  item has no expected date but has been on order longer than that
  supplier's historical average lead time), and **Recently delivered** (with
  computed lead time + a per-supplier average lead-time chip strip).
- **Approvals** (`#/approvals`) — read-only, every approval across active
  projects grouped into Pending/Approved/Rejected, with age/overdue badges
  and the same spec-drift warning used on the FF&E tab. No inline
  approve/reject — links into the project to act.
- **Budget** (`#/budget`) — per-project FF&E spend + labor cost + committed
  total vs. budget, sorted by %-of-budget-used descending (budget-unset
  projects always sort last regardless of spend); a summary strip splits
  "total budget" (only counts projects with one set) from "total committed"
  (includes unset projects' real spend anyway).
- **Boards** (`#/boards`) — per-project open/overdue board-card counts,
  sorted overdue-first, with the top 5 overdue cards listed per project (the
  badge always shows the true overdue count even when the list is capped).
  Projects whose board has zero cards are excluded entirely; projects whose
  cards are all in the terminal column show correctly as 0/0, not excluded.
- **Library** (`#/library`, added 2026-09-07) — see **Product Library**
  below. Its project links use `onclick="activeTab='clipper'"`, following
  the convention below.

**Product Library** (`#/library`): not a separate data store — it's a live
aggregation (`getLibraryItems()`) over every project's `state.clips[projId]`
(each clip already carries full product-spec fields — see Web Clipper
above) plus the project-less `state.clips[LIBRARY_BUCKET]` bucket, so saving
or editing a clip anywhere is automatically reflected here with nothing to
keep in sync. Search by title/supplier/category; a summary strip shows
total product/supplier counts. Each card's **"Import to project"** action
(`openImportLibraryItem`/`importLibraryItem`) opens a project picker +
optional room/qty/cost override and copies the item's full spec into a
brand-new FF&E row in **any** project — not just the one it was clipped
from. A cross-project import can't carry a live thumbnail link back to the
source clip (a clip only exists in its home project's array — or the
library bucket's — so `ffeRowHtml`'s thumbnail lookup only resolves within
that same array); the FF&E row still gets every spec field, just without
the inline image. A **"+ Add product"** button (also offered in the empty
state) lets the designer add a product directly to the library with no
project attached at all — same form, minus the two fields that only mean
something with a project (client-moodboard flag, FF&E link) — saved into
`state.clips[LIBRARY_BUCKET]` via `openNewLibraryClip`/`createLibraryClip`.
These project-less cards show "Library item" instead of "From
&lt;project&gt;" and get their own delete action (`deleteLibraryClip`),
since there's no project Web Clipper tab where they could otherwise be
cleaned up.

**`activeTab` convention**: clicking a project link from ANY cross-project
view should either target a specific relevant tab (`onclick="activeTab='X'"`
— e.g. Approvals overview → `'approvals'`, Boards → `'board'`, Library →
`'clipper'`) or explicitly reset it to the default (`'ffe'`) — `activeTab`
is a shared global read by `renderProject()` on every project open, so a
link that does neither can leak a stale tab selection from whatever was
last clicked elsewhere. All seven cross-project views (Team/Deadlines/
Procurement/Approvals/Budget/Boards/Library) and the dashboard's attention
strip follow this convention — keep it consistent if an 8th cross-project
view is ever added.

## Client portal (`#/portal/:id`)

Rebuilt into an actual dashboard, in this order: **white hero band** (AJ
Interiors logo, cover photo, name, client, status — no internal controls)
→ a **curved SVG wave-divider** easing into the greige body → an italic
one-line welcome → progress pills (milestones done/total, pending approvals
— **deliberately no budget/spend figures**, which stay internal) →
**Product Schedule** (FF&E items opted in via the `forClient` flag — see
FF&E Schedule above — showing name/category/status/dimensions/finish/
spec-link but **never cost/qty/supplier/SKU**) → read-only milestone
timeline → moodboard → approvals (with visual references and full decision
history/comments) → a "Say hello" shared Client Comments section. Branding
and copy tone were matched directly to ajinteriors.com.au on 2026-09-07 —
see Brand identity in Architecture above.

## Job-site view (`#/trades/:id`)

Standalone, no-login page meant to be linked/QR'd for trades on site — the
**builder** half of the FF&E audience split (the client half is the portal
above). Two sections: **Site tasks** (unchanged — the existing checklist,
backed by `state.tradesTasks[id]`, synced both directions with the internal
Site Tasks tab) and **Materials & FF&E** (added 2026-09-07,
`renderTradesFfe`) — FF&E items opted into `showToTrade`, showing
room/category/supplier/SKU/dimensions/qty/status/expected-delivery but
**never cost**, the same never-show-commercial-figures rule the client
portal follows for its own reasons.

## Other features

- **Invoice generator** (`exportInvoice`/`generateInvoice`) — FF&E line
  items + a Labor section (`getProjectLaborCost`, shared with the Budget
  view), markup %, auto-incrementing invoice numbers, prints a document.
- **Purchase order generator** — see Procurement above; per-supplier PO
  counters in `state.poCounters`.
- **Print summary** (`printProjectSummary`) — a simpler one-page snapshot.
- **Full backup/restore** — Export/Import buttons on the dashboard dump/load
  the entire `state` object as JSON, destructive-overwrite confirmed.
- **Global search** (`openGlobalSearch`/`runGlobalSearch`) — searches FF&E,
  clips (title/category/supplier), approvals, notes, **board cards, site
  tasks, contacts (name only), and client comments** across all projects,
  excludes archived projects. Does not currently reach the Product
  Library's project-less bucket (`state.clips[LIBRARY_BUCKET]`) — only
  per-project clips, since global search is scoped project-by-project.
- **Dashboard** — search/filter, "Show archived" toggle, per-card budget
  progress bar + spend label, pending/overdue-approval + unread-comment
  badges, a "Needs attention" strip aggregating urgency signals across the
  whole practice, a rich first-run empty state, project delete (permanent,
  archived-only).
- **Mobile**: the project tab strip wraps onto multiple pill rows (see
  Project workspace tabs above, redesigned 2026-09-07 — no longer
  horizontal-scroll); the FF&E/Time Tracking tables and the header nav
  remain horizontally scrollable (`overflow-x-auto`) rather than clipping/
  overflowing; the project-hero header's button groups wrap onto their own
  rows instead of overlapping on narrow widths (fixed 2026-09-07).

## Known non-issues / deliberate choices

- `designerDecide`/`clientDecide` both write to the same approval object;
  either side can revise a decision at any time (not gated on current
  status).
- Rates (`state.rates`) and PO counters (`state.poCounters`) are
  practice/supplier-wide, not per-project.
- The client-comment poster's name (`localStorage.ajd_client_name`) is
  global, not per-project — deliberate, since one portal link is one person.
- No auth anywhere — intentional for a demo; unlinked-by-obscurity only.
- Supplier-name matching is inconsistent between features: `getPredictedLateInfo`
  (Procurement) is exact-trim/case-sensitive, while `getReadyToOrderEntries`
  is case-insensitive. Flagged, not fixed — candidate for a future pass.
- Native HTML5 drag-and-drop on the Board tab has no mobile/touch support
  (a browser platform limitation); the `<select>` dropdown move mechanism is
  kept specifically as that fallback.
- A cross-project Product Library import can't carry a live thumbnail link
  back to its source clip — `ffeRowHtml`'s thumbnail lookup only resolves a
  `clipId` within the *same* project's (or the library bucket's) clip array,
  so `importLibraryItem` only sets `clipId` when importing within the
  source's own project. Every other spec field still copies across fully;
  only the inline thumbnail is project-scoped. Flagged, not fixed — the
  cost of a genuine cross-project reference wasn't judged worth it here.
- Global search doesn't reach `state.clips[LIBRARY_BUCKET]` (the Product
  Library's project-less items) — it's scoped project-by-project and that
  bucket isn't a project. Use the Library page's own search instead.

## Working conventions for this project

- Ongoing development follows [ITERATE.md](ITERATE.md)'s standing loop:
  **Analyze** (gap vs. the site vision) → **Plan** (scoped implementation
  plan) → **Execute** (build it, first-pass smoke test) → **Bugfix**
  (independent agent re-verifies from scratch, doesn't trust the
  implementer's claims, fixes real bugs) → repeat. Read
  [ITERATION_LOG.md](ITERATION_LOG.md) before proposing new work. This loop
  is currently closed (concluded at iteration 22); further work has come as
  direct ad hoc user requests instead (see History) — restart the loop
  explicitly if that's what's wanted again, rather than assuming it's live.
- Sonnet subagents for every stage of that loop.
- Before making UI/branding decisions, check whether the designer's actual
  site (ajinteriors.com.au) already establishes a convention (palette,
  type, tone, a specific feature like the wave-divider) — the 2026-09-07
  reskin was built from directly reviewing that site rather than guessing,
  and CLAUDE.md's Brand identity note above should be kept in sync with it
  if the real site ever changes.
- After clearing `localStorage` to test fresh-seed behavior, remember that a
  **hash-only URL change does not reload the page** in this browser tooling
  — `state` stays in memory from before the clear. Always force a real
  `location.reload()` before asserting what "fresh seed" looks like. This
  bit multiple verification passes during development — see the recurring
  gotcha note above.
- The modal system (`#modal-backdrop`/`#modal-body`) scrolls internally
  (fixed 2026-09-07 — it previously had no overflow handling and could clip
  its own Save/Cancel buttons on a short viewport). Keep new modals inside
  the existing `showModal()`/`.card` pattern so they keep that scroll
  behavior for free; don't reintroduce a fixed-height/no-overflow container.
- Keep everything in the single `ajd.html` file — no build step, no
  framework, by design.
