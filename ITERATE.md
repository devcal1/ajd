# AJD Iteration Loop — Vision-Driven Development

This is the standing development process for [ajd.html](ajd.html), replacing the
earlier open-ended "assess two random improvements" loop. Every iteration must be
justified by closing a real gap between the current app and the **Site Vision**
below — not just "another nice feature."

## Site Vision

> A specialized project management and specification software website designed
> for **AJ Design** ([www.ajinteriors.com.au](https://www.ajinteriors.com.au)) to
> streamline their studio workflows. It combines FF&E (Furniture, Fixtures, and
> Equipment) scheduling, procurement, and client collaboration into a single
> digital workspace. Key capabilities include creating live product schedules,
> tracking lead times, sharing interactive client approval dashboards, and
> managing tasks through custom boards — ultimately eliminating messy
> spreadsheets and reducing design errors. The site app is a self-contained,
> feature-dense one-page website.

Read this as the north star, not a literal checklist — e.g. "AJD" as the current
placeholder brand already aligns with "AJ Design," so no rename is implied unless
an iteration finds a concrete reason to touch it.

## Constraints (carried over from prior loops)

- Single file, client-only: everything stays in `ajd.html` — no build step, no
  framework, no backend. `localStorage`-backed.
- All work is done by **Sonnet subagents** (`Agent` tool, `model: "sonnet"`) —
  never do the analysis/implementation/verification inline in the main thread.
- **Every stage runs as an independent subagent with no memory of the others' claims.**
  The Verify/Bugfix agent must retest from scratch in a live browser
  (`py -3 -m http.server 8420` from this directory, then Browser tools against
  `http://localhost:8420/ajd.html`) — never trust the Implementer's self-report.
- **Known gotcha:** a hash-only URL change does not reload the page in the Browser
  tool — `state` stays in memory. Always force a real `location.reload()` after
  `localStorage.clear()` before asserting what "fresh seed" looks like.
- Read `CLAUDE.md` in this folder first for current architecture/feature inventory
  before proposing anything, so suggestions don't duplicate existing work.

## The loop (5 stages, repeat indefinitely)

### 1. Analyze
Spawn a Sonnet subagent to:
- Read `ajd.html` (current state) and `CLAUDE.md` (feature inventory) in full.
- Compare the app against the Site Vision's five pillars: **live product
  schedules**, **procurement/lead-time tracking**, **interactive client approval
  dashboards**, **custom task boards**, **spreadsheet-elimination /
  error-reduction**, plus the **"self-contained, feature-dense one-page site"**
  framing itself (navigation model, information density, whether it *feels* like
  one product or a pile of tabs).
- Identify the SINGLE section or workflow with the largest remaining gap against
  that vision — could be a missing capability, a workflow that's technically
  present but clunky/hidden, or a structural/navigation problem.
- Output: a short gap statement (what's missing/broken, why it matters against
  the vision, roughly how big) — not a solution yet.

### 2. Plan
Spawn a Sonnet subagent (fresh, given the Analyze output) to:
- Turn the identified gap into a concrete implementation plan: exact functions/
  DOM ids to touch or add, data model changes (new `state.*` fields), UI/markup
  changes, and how it integrates with existing patterns (reuse established
  helpers — `categoryChipHtml`, `personAvatarHtml`, `logActivity`, the
  Kanban/timeline/masonry visual patterns already in the app — don't invent a
  new visual language where an existing one fits).
- Explicitly scope what is OUT of scope for this iteration, to keep it a single
  reviewable change.
- Output: a numbered implementation plan concrete enough that the next agent
  needs no further judgment calls on *what* to build, only *how* to code it.

### 3. Execute
Spawn a Sonnet subagent (fresh, given the Plan) to:
- Implement the plan in `ajd.html` exactly as scoped.
- Re-read the diff for JS/template-literal syntax errors before finishing.
- Do a first-pass live smoke test (server + Browser tools) to confirm it doesn't
  crash and roughly works — but this is not the real verification pass.
- Output: what changed (file/line ranges), and what it self-verified.

### 4. Bugfix (independent verification)
Spawn a **different** Sonnet subagent (fresh, given only the Plan + what
Execute claims to have changed — not the Execute agent's confidence) to:
- Re-test the change from scratch in a live browser, clearing `localStorage`
  and forcing a real reload, covering the happy path AND edge cases (empty
  states, zero/negative values, interaction with existing features it touches
  or sits near).
- Fix any real bug found directly in `ajd.html`, then re-verify the fix.
- Run a quick regression check that nothing else obviously broke (e.g. click
  through the tabs/routes adjacent to the change, check the console).
- Output: what was tested, what was broken (if anything) and fixed, final
  verdict.

### 5. Repeat
Go back to step 1. Each Analyze pass should read the *current* file fresh (it
will have changed) and should not re-suggest anything already covered in this
loop's own history — keep a running one-line log of what each iteration did
(feature/area touched) to pass into the next Analyze prompt so it doesn't repeat
itself.

## After each iteration

Refresh the running app in the Browser tool (clear storage, real reload) so the
user can see the current state. Keep a brief log (one line per iteration: what
gap was closed) — append it to `CLAUDE.md`'s history section periodically (e.g.
every 5 iterations) so the project doc doesn't drift from reality before the
next `/clear`.
