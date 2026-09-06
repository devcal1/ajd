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
2. Procurement/lead-time tracking (vision pillar: "tracking lead times") — FF&E items auto-capture orderDate/deliveredDate on status transitions; new cross-project "Procurement" view (on-order + recently-delivered lists, supplier avg lead time). Bug found+fixed: Delivered→Ordered→Delivered round-trip resurrected a stale deliveredDate instead of stamping fresh.
3. Visual reference on approvals (vision pillar: "interactive client approval dashboards" for a visual business) — approval requests can link to a Web Clipper clip, rendered as a prominent thumbnail on the card in both the internal Kanban and the client portal. Clean pass, no bugs. Noted but not fixed (pre-existing, out of scope): unescaped quotes in raw inline SVG data-URI clip images can break the `<img>` attribute — affects the Web Clipper generally, not introduced by this iteration.
4. Client portal rebuilt as an actual dashboard (vision pillar: portal was the weakest realization of "interactive client approval dashboards") — hero header, progress pills (milestones done/total, pending approvals; deliberately NO budget/spend), read-only milestone timeline (refactored `milestoneTimelineHtml` shared between internal/portal), moodboard, approvals. Clean pass, no bugs — refactor of a working feature (Milestones tab) verified with no regressions.
5. Board cards deepened + wired into cross-cutting systems (vision pillar: Board was still MVP-depth vs. FF&E/Milestones/Site Tasks) — cards gain dueDate/assigneeContactId, overdue cards feed Next Actions/Deadlines calendar/Team workload the same way site tasks do. Bug found+fixed: appending a new board column redefined "last column," retroactively resurrecting already-resolved cards as overdue; fixed by always inserting new columns before the terminal one.
6. Client-facing FF&E product schedule (vision pillar: "live product schedules" never reached the client-facing portal) — per-item "Show on client portal" checkbox (mirrors clips' forClient), new Product Schedule section on the portal showing name/category/read-only status only — no cost/qty/supplier. Clean pass, no bugs.
7. Approval comments/feedback (vision pillar: "interactive" approval dashboards — rejections were a status flip with no reason recorded) — decisions now go through a modal requiring a reason on "Request changes" (optional on Approve), full decision history (with comments) shown on both internal Kanban and portal. Rewrote the existing history-tracking logic (previously "push prior state before overwrite" with a bogus-first-entry guard) to "push every decision unconditionally" — high regression risk, verified clean with no bugs.
8. Client discussion feed (vision pillar: "client collaboration" was one-directional beyond approvals) — new shared, project-wide comment thread visible on both a new internal "Client Comments" tab and a new portal section; client posters prompted once for a name (stored globally in localStorage, deliberately not per-project). Clean pass, no bugs.
9. FF&E specification fields (vision pillar: "specification software" had zero actual spec data — only cost/status) — items gain optional SKU/dimensions/finish/product-URL, shown via an expandable caret row (not new table columns) to avoid crowding; client portal shows dimensions/finish/link but not SKU; CSV export includes all 4. Clean pass, no bugs.
10. Unread client-comment badges (vision pillar: "client collaboration" had no notification signal — staff had to manually check every project) — new `lastSeenByStaff` timestamp per project, comments gain a precise `dateTime`, badge on the internal tab button + dashboard card, marked seen only on actually opening the Client Comments tab (not on unrelated project-page renders). Clean pass, no bugs — the seen-marking timing was the highest-risk part and held up under rigorous testing.
