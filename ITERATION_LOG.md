# AJD Iteration Log

One line per completed loop iteration (Analyze → Plan → Execute → Bugfix), per
ITERATE.md. Read this before proposing a new gap in the Analyze stage so work
isn't repeated.

Iterations 1-30 (prior loops, logged in CLAUDE.md's feature inventory, not
itemized here): built out FF&E CRUD/budget/status/category/room-grouping/CSV/
clip-linking/delivery-dates, dashboard redesign+search+archiving+badges, Time
Tracking CRUD/CSV/rates/bar-chart, Web Clipper masonry+preview+fallback,
Approvals history/portal/Kanban board, Notes tab redesign, Contacts directory,
Site Tasks CRUD/assignees/urgency-grouping, Milestones timeline, Activity log,
global search, Next-actions digest, project hero header, invoice generator,
Print summary, JSON backup/import, Team workload view, Deadlines calendar,
mobile tab-strip fix.

Format below: `N. <gap closed> — <one-line result>`

1. Custom task board (vision pillar: "managing tasks through custom boards") — new 10th "Board" tab, per-project user-defined columns + cards, move-via-dropdown, delete-guarded columns. Bug found+fixed: migration for old saves wasn't persisting new board state.
