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
  history in [ITERATION_LOG.md](ITERATION_LOG.md).

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
  - `#/trades/:id` — standalone job-site checklist view (no login, meant to
    be linked/QR'd to trades on site)
  - `#/portal/:id` — standalone client-facing portal/dashboard
- State is one big object in `state` (module-level), persisted via
  `save()`/`load()` to `localStorage` key `ajd_state_v1`. Shape (all keyed by
  project id except `rates`/`poCounters`, which are practice/supplier-wide):
  `projects`, `ffe`, `time`, `clips`, `approvals`, `tradesTasks`, `notes`,
  `activity`, `milestones`, `contacts`, `invoices`, `rates`, `boards`,
  `comments`, `lastSeenByStaff`, `poCounters`.
- Brand palette: terracotta/ink, Fraunces (display) + Inter (body), CSS
  custom properties in `:root`.
- Fonts/Tailwind loaded from CDN — this app is a demo/prototype, not
  optimized for a fully offline environment.

## Project workspace tabs (per `#/project/:id`)

The tab strip is visually grouped into 4 clusters (labels + dividers; purely
cosmetic — `data-tab`/`setTab`/`activeTab` mechanics are unaffected):

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
   (`orderDate`/`deliveredDate` auto-stamped on status transitions), and an
   **approval-status badge** per item (Pending/✓ Approved/Changes
   requested/⚠ Spec changed since approval — the last one via spec-drift
   detection comparing the item's current spec against what was snapshotted
   at approval time).
2. **Time Tracking** — full CRUD, CSV export, per-person bar-chart
   breakdown, optional practice-wide hourly rate per person → labor cost,
   folded into invoices and the cross-project Budget view.
3. **Web Clipper** — Pinterest-style masonry moodboard, broken-image
   fallback, live image preview, optional link from a clip to an FF&E item
   OR to an approval (visual reference on what's being approved), "show on
   client portal" flag per clip.
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

**`activeTab` convention**: clicking a project link from ANY cross-project
view should either target a specific relevant tab (`onclick="activeTab='X'"`
— e.g. Approvals overview → `'approvals'`, Boards → `'board'`) or explicitly
reset it to the default (`'ffe'`) — `activeTab` is a shared global read by
`renderProject()` on every project open, so a link that does neither can leak
a stale tab selection from whatever was last clicked elsewhere. All six
cross-project views (Team/Deadlines/Procurement/Approvals/Budget/Boards) and
the dashboard's attention strip follow this convention as of iteration 22 —
keep it consistent if a 7th cross-project view is ever added.

## Client portal (`#/portal/:id`)

Rebuilt into an actual dashboard, in this order: hero header (cover photo,
name, client, status — no internal controls) → progress pills (milestones
done/total, pending approvals — **deliberately no budget/spend figures**,
which stay internal) → read-only milestone timeline → **Product Schedule**
(FF&E items opted in via a per-item "Show on client portal" checkbox,
showing name/category/status/dimensions/finish/spec-link but **never
cost/qty/supplier/SKU**) → moodboard → approvals (with visual references and
full decision history/comments) → shared Client Comments section.

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
  clips, approvals, notes, **board cards, site tasks, contacts (name only),
  and client comments** across all projects, excludes archived projects.
- **Dashboard** — search/filter, "Show archived" toggle, per-card budget
  progress bar + spend label, pending/overdue-approval + unread-comment
  badges, a "Needs attention" strip aggregating urgency signals across the
  whole practice, a rich first-run empty state, project delete (permanent,
  archived-only).
- **Mobile**: the project tab strip, the FF&E/Time Tracking tables, and the
  header nav are all horizontally scrollable (`overflow-x-auto`) rather than
  clipping/overflowing — fixed across iterations 16/18 as real bugs found
  during verification.

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

## Working conventions for this project

- Ongoing development follows [ITERATE.md](ITERATE.md)'s standing loop:
  **Analyze** (gap vs. the site vision) → **Plan** (scoped implementation
  plan) → **Execute** (build it, first-pass smoke test) → **Bugfix**
  (independent agent re-verifies from scratch, doesn't trust the
  implementer's claims, fixes real bugs) → repeat. Read
  [ITERATION_LOG.md](ITERATION_LOG.md) before proposing new work.
- Sonnet subagents for every stage.
- After clearing `localStorage` to test fresh-seed behavior, remember that a
  **hash-only URL change does not reload the page** in this browser tooling
  — `state` stays in memory from before the clear. Always force a real
  `location.reload()` before asserting what "fresh seed" looks like. This
  bit multiple verification passes during development — see the recurring
  gotcha note above.
- Keep everything in the single `ajd.html` file — no build step, no
  framework, by design.
