# Figma Foundation Round-Trip — Session Handoff (2026-05-15)

This document hands off the in-flight work to a new Claude session. Read this top-to-bottom before doing anything else.

## TL;DR for the next session

We are **mid-way through Phase 3 of the Round 1 implementation plan**. Specifically: **Task 3.3 (USER REVIEW GATE — Foundation page)** has been iterated through several rounds of feedback and is currently **awaiting final user approval** on iteration v4 of the workspace shell. No code in `frontend/` has been touched yet. All design work to date lives in the Figma file. The very next action is to wait for the user's "approved" on the Foundation page, then run **Task 4.1**.

The skill stack that should be active when resuming: `superpowers:subagent-driven-development` (we're executing the plan via subagent-driven mode).

## Where everything lives

| Asset | Location |
|---|---|
| Git repo (this worktree) | `/Users/anjani.dabkara/ai-dq-accelerator/.claude/worktrees/nifty-jang-40768d` |
| Git branch | `claude/nifty-jang-40768d` |
| User's main checkout (with running `next dev`) | `/Users/anjani.dabkara/Downloads/GitHub/ai-dq-accelerator` |
| Spec doc | `docs/superpowers/specs/2026-05-14-figma-roundtrip-redesign-design.md` (committed at `fc47de1`) |
| Plan doc | `docs/superpowers/plans/2026-05-14-figma-foundation-roundtrip.md` (committed at `5714e84`) |
| This handoff | `docs/superpowers/context-handoff/2026-05-15-figma-foundation-handoff.md` |
| Figma file | `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx/DQ-Accelerator` |
| Figma file key | `gsnW43uSpvdLpwandZM8Zx` |

**Important worktree note:** the user's `next dev` is running from their primary checkout, NOT this worktree. When Phase 4 code translation begins, they must either `cd` their dev server into this worktree's `frontend/` or merge the branch into their primary checkout. Flagged earlier in conversation. Worktree has its own `node_modules` already installed (Next 16.2.1, React 19.2.4).

## The product being built

DQ Accelerator workspace UI is being redesigned via a Figma round-trip workflow with **swappable per-client branding**. UDig is the default brand; Tractor Supply is the stub second brand for demoing the swap mechanic to client prospects. A theme = one config file (`frontend/lib/theme/themes/<id>.ts`) defining 3-5 brand colors + a logo. URL `?client=<id>` overrides at runtime; `NEXT_PUBLIC_CLIENT` env overrides at build time; default = UDig.

Round 1 = foundation only (tokens + workspace chrome). Round 2 = stages, one plan per stage, written when we get to each. **The current plan covers Round 1 only.**

## Decisions captured during brainstorm + drafting

Some of these deviate from or extend the original spec — they are the authoritative current state.

### Style direction

- **Full visual redesign** (not a refresh of the current UI).
- UDig-branded by default. Anchor visual values pulled from real UDig.com CSS:
  - `color/brand/primary` = `#FF8200` (UDig orange)
  - `color/brand/accent` = `#002B40` (UDig deep navy)
  - `color/brand/on-primary` = `#FFFFFF`
- Tractor Supply stub values:
  - primary `#D62828` red, accent `#1A1A1A` near-black, on-primary white.
- Light mode only for v1. Dark mode deferred.

### Token architecture additions (beyond what spec described)

Spec mentioned a base token set. During implementation we added the following because they were needed to pass WCAG AA on light backgrounds:

- `color/semantic/{success,warning,danger,info}-deep` — darker variants for use as **text on white surfaces**. Original semantic colors are now reserved for borders, status dots, icons, and decorative fills only.
- `color/accent/purple` + `color/accent/purple-deep` — for THINKING-type AI events.
- `color/accent/indigo` + `color/accent/indigo-deep` — for TOOL CALL-type AI events. Same indigo (`#6366F1`) the existing codebase used.

Theme contract (the `Theme` TS type defined in plan Task 4.2) does NOT need to expose these — they remain system-level (mode-less) and are written into `globals.css :root` as static defaults. Only the Brand colors + logo + favicon vary per client.

### Visual decisions worth knowing at code-translation time

1. **TopBar (56px tall)** contains: `<Logo />` → app title "DQ Accelerator" (14px Semi Bold, `fg/default`) → 1px vertical separator (`border/subtle`) → `← Sessions` breadcrumb → `/` → filename (14px Semi Bold) → row/col metadata (12px, `fg/muted`) → flex spacer → ScoreChip → overflow `⋯` (3 dots in a row). Logo background uses `color/brand/accent` (white wordmark on navy/black) which is brand-canonical for UDig.

2. **Stepper rail (220px wide)**: 10 stages, manual-positioned (no auto-layout) so connectors pass through circle centers as one continuous vertical line. Connector color = `color/semantic/success` after a done stage, `color/border/strong` otherwise. Circles are 18px. Inside each circle:
   - **default** (unused, but defined in the component): empty 18px circle, outline `border/strong`
   - **active**: solid `brand/primary` fill + 6px white inner dot
   - **done**: solid `semantic/success` fill + white SVG checkmark
   - **locked**: solid `border/strong` fill + small lock SVG (USER NOTED THIS MIGHT CHANGE — see "User notes still pending integration" below)

   Sub-status text under the active stage's **label** (not under its circle). Currently shows "synthesizing…" at 12px `fg/muted`, indented at `LABEL_X` = 52 within the rail.

3. **AIPanel (340px wide)** has three sections stacked vertically:
   - **Header** (48px): `StatusDot` + "AI Activity" title + flex spacer + `SegmentedControl` (Feed/Terminal).
   - **Feed** (flex-1): stack of AI event cards. Card width = exactly 316px (340 − 24 padding).
   - **WaitingBanner**: stretches full panel width, no rounded corners (footer bar style, not floating pill).

4. **AI event cards** — 4 types: `ToolCallCard`, `ResultCard`, `ThinkingCard`, `DoneCard`. Each has 2 variants: `highlighted=false|true`. Highlight = border color changes from `color/border/subtle` to the card's accent color + `strokeWeight` bumps from 1 → 1.5. No left accent stripe (removed in v4).

5. **Score chip** in TopBar: 3 variants (success / warning / danger). White surface, semantic-colored border, `semantic-deep` text. Thresholds preserved from current code: ≥90 success, ≥70 warning, else danger.

### Things deliberately deferred to Round 2 stage implementations

YAGNI for Round 1:
- Button, Input, Select, Card, Table — first stage that needs them (Load → upload button) will introduce them.
- Soft-tint background variables (e.g., `color/semantic/success-soft`) — only introduce if a stage needs tinted card surfaces.
- Hover/pressed state token variants for brand colors (`brand/primary-hover` = `#FF9B33`, `brand/primary-pressed` = `#CF6A00`, etc. — these exist in UDig's CSS, just not in our tokens yet).
- Dark mode.

## Figma file state (as of 2026-05-15)

### Pages (in order)

1. `00 — Tokens` — color ramps (Brand UDig + Tractor Supply side-by-side, System colors grouped), Inter type specimen, radius reference, spacing reference.
2. `01 — Components` — StepperItem (4 variants), ScoreChip (3), StatusDot (3), SegmentedControl (2), Logo (1), WaitingBanner (1), ToolCallCard (2), ResultCard (2), ThinkingCard (2), DoneCard (2). Variant axes: `state=`, `variant=`, `active=`, `highlighted=`.
3. `02 — Foundation` — Two shells side-by-side at 1440×900 each. Left: `Shell / 1440x900 / UDig / v2`. Right: `Shell / 1440x900 / Tractor Supply / v2` (mode-overridden clone). Both built from instances of components on page 01, so token tweaks propagate.
4. `99 — Archive` — currently empty, reserved for superseded frame versions.

### Variable collections

- `Brand` (id `VariableCollectionId:4:2`) — modes: `UDig` (id `4:0`), `Tractor Supply` (id `4:1`). Contains: `color/brand/{primary,accent,on-primary}`.
- `System` (id `VariableCollectionId:4:3`) — single `Default` mode (id `4:2`). Contains:
  - `color/bg/{canvas,surface,elevated}`
  - `color/fg/{default,muted,subtle,inverse}`
  - `color/border/{subtle,strong}`
  - `color/semantic/{success,warning,danger,info}` + `*-deep` variants
  - `color/accent/{purple,indigo}` + `*-deep` variants
  - `space/{2,4,6,8,12,16,20,24,32,40,48,64}` (FLOAT)
  - `radius/{sm,md,lg,full}` (FLOAT)

### Resolving current values

To pull authoritative values at code-translation time, call `mcp__figma__get_variable_defs` against the approved shell node id. The approved frame to read from will be whichever `Shell / 1440x900 / UDig / v<final>` is current at approval time (currently v2 with all v4-iteration changes applied via in-place rebuild — see git/figma history if confused).

## Plan progress (cross-referenced to the plan doc)

```
Phase 0 — Prep & recon
  [x] 0.1  Verify worktree dependencies
  [x] 0.2  Read Next 16 root-layout + client-component docs
  [x] 0.3  UDig brand recon (used UDig.com CSS for authoritative values)

Phase 1 — Figma: Tokens page
  [x] 1.1  Page skeleton + variable collections
  [x] 1.2  Token reference frames drawn
  [x] 1.3  USER APPROVED (after the verify-against-UDig.com iteration)

Phase 2 — Figma: Components page
  [x] 2.1  Components built (all 10 component sets)
  [x] 2.2  USER APPROVED (after multiple iterations: AA color fix, lock icon for locked
            stepper variant, vector-icon replacements for emoji, etc.)
  [x] 2.3  (added) Iterate components per Foundation review feedback:
            AI cards rebuilt at 316px native width, highlight via border color
            instead of left stripe.

Phase 3 — Figma: Foundation shell
  [x] 3.1  UDig shell drafted
  [x] 3.2  Tractor Supply mode clone
  [>] 3.3  USER REVIEW GATE — pending final approval on v4 of the shell
           (latest screenshot shows all earlier feedback addressed)

Phase 4 — Code translation (all PENDING — to be done by subagents)
  [ ] 4.1  Read approved Figma variable values via get_variable_defs
  [ ] 4.2  Theme TS type
  [ ] 4.3  resolve.ts + tests
  [ ] 4.4  apply.ts + tests
  [ ] 4.5  themes/udig.ts + themes/tractor-supply.ts + _registry.ts
  [ ] 4.6  Logo component + tests
  [ ] 4.7  ThemeProvider + tests
  [ ] 4.8  globals.css rewrite
  [ ] 4.9  tailwind.config.ts rewire
  [ ] 4.10 Logo SVG assets
  [ ] 4.11 Root layout wrap
  [ ] 4.12 TopBar update — INCLUDES the "DQ Accelerator" app title + separator
  [ ] 4.13 Stepper update — INCLUDES sub-status line + lock icon + 18px circles
            with inner content (white check / inner dot / lock glyph)
  [ ] 4.14 AIPanel update — INCLUDES rendering the 4 card types per event.event
            value with the highlighted variant for the most recent/active event.
            Banner stretches full width, no rounded corners.

Phase 5 — Verification
  [ ] 5.1  Default theme + ?client=tractor-supply + unknown-client fallback
  [ ] 5.2  Tag foundation-v1
```

## Deviations from plan to apply at code time

These were decided during Phase 1-3 review and should override the plan when they conflict:

1. **`tailwind.config.ts` rewire (Task 4.9)** — must also map the new token names:
   - `accent-purple`, `accent-purple-deep`, `accent-indigo`, `accent-indigo-deep`
   - `success-deep`, `warning-deep`, `danger-deep`, `info-deep`
   The plan's example config doesn't include these yet. Add them.

2. **`globals.css` (Task 4.8)** — must include the `accent` and `*-deep` variables under `:root`.

3. **Theme TS type (Task 4.2)** — keep it as the plan specifies. Accent/semantic-deep are NOT exposed on `Theme` because they're system-level.

4. **TopBar (Task 4.12)** — add the app title and separator between Logo and breadcrumb. Plan said only Logo + breadcrumb; that's outdated.

5. **Stepper (Task 4.13)** — circle implementation needs:
   - 18px circles (plan had 8px dots).
   - Inner content per state: white SVG checkmark (done), 6px white dot (active), 12px lock SVG (locked).
   - Connector lines positioned through circle centers (not between rail items). The current code's between-items approach won't match.
   - Sub-status indented under label, not below the row. Wire via existing `WAITING_MESSAGES[stage]` map.

6. **AIPanel (Task 4.14)** — render different card layouts for `event.event` values: `tool_call` (indigo), `tool_result` (success/green), `thinking` (purple, italic body), and an implicit `done` (neutral). Each card has a highlighted state — most recent event gets `highlighted=true`. Cards are full-width inside the feed (panel inner width minus 24 padding).

## User notes still pending integration into the Figma shell

The user's most recent message (right before they asked to consolidate) requested two more changes I had NOT yet applied to the Figma file:

1. **Smaller checkmark on the done step (Load)** — user reduced it manually in their own Figma session and wants the new size reflected as the standard for all done states. **Next session: pull `get_design_context` on the Load circle in the user's manually-edited frame and apply the matching dimensions to the `state=done` variant of StepperItem.** Also re-apply to whichever foundation shell needs it.

2. **Switch locked stepper variant from lock-icon to a centered dot** — user wants locked circles to show a dot in the middle (similar to active's inner dot), removing the lock glyph. The lock concept is being dropped. Updated locked visual:
   - Circle fill: stay `border/strong` gray (or possibly bg/elevated — confirm with user)
   - Inner: small centered dot (probably 4-5px in `fg/muted` or similar contrast)

3. **WaitingBanner UDig manual change** — user manually adjusted the UDig version of the WaitingBanner to a layout they prefer. **Next session: inspect the UDig shell's WaitingBanner via Figma to see what they changed and apply the matching design to the WaitingBanner component on page 01.** Then re-clone TS shell so it picks up the change too.

4. **Buttons + other foreseen components** — user asked: "I also know we will need buttons down the line so should we make those components and other that we know will exist?" I had not answered yet. **Suggested response when resuming:** propose adding a small core component pack now (Button primary/secondary/ghost, Input, Select, Checkbox/Toggle, Modal/Dialog shell) since the user explicitly wants them. Build only enough variants for what Stage 1 (Load) needs first — primary upload button + a secondary cancel button.

## Outstanding user prompt to address

The user said: "consolidate this context and I'll switch to a new session." So **this handoff doc IS the response to that.** They expect to start a new session next and have it pick up here.

When the new session starts, it should:

1. Invoke `superpowers:using-superpowers` skill (auto on first message).
2. Read **this handoff doc** first, then the plan, then the spec.
3. Invoke `superpowers:subagent-driven-development` since we're already executing the plan in that mode.
4. **Do not re-do the brainstorm or plan-writing.** Both are done and committed.
5. The first user-facing action should probably be:
   - Acknowledge handoff received.
   - Ask the user to confirm the pending items #1-3 above (smaller check, locked-as-dot, banner change) by referencing the existing Figma file, then apply them.
   - Then ask about #4 (buttons).
   - Then proceed to the final approval of Task 3.3.

## Critical caveats / pitfalls

- **`use_figma` Plugin API gotchas already encountered:**
  - `figma.combineAsVariants(nodes, parent)` requires `nodes` to be `ComponentNode[]`, not `FrameNode[]`. Build frames → `figma.createComponentFromNode(frame)` → then combine.
  - `setBoundVariableForPaint` **overrides paint opacity**. The `{ opacity: 0.1 }` trick on a SOLID paint does not survive variable binding. Use solid neutral surfaces + colored borders/text instead, or add explicit `*-soft` token variants.
  - `figma.createNodeFromSvg(svgString)` is reliable for icons. Direct `vectorPaths` produces filled-shape weirdness when you wanted strokes.
  - Avoid `findOne(n => n.name === 'Feed')` — it matches text nodes named "Feed" inside the SegmentedControl too. Filter by `type === 'FRAME'` or specific component name.
- **No code in `frontend/` has been touched.** Don't be surprised that running `next dev` against this worktree still shows the OLD UI. The redesign is Figma-only until Phase 4.
- **The user's running `next dev` is from their primary checkout** (`~/Downloads/GitHub/ai-dq-accelerator`), not this worktree. Verification at Phase 5 requires them to switch.

## Figma component IDs (for `get_design_context` calls during code-gen)

Recorded at last build; may shift slightly if components are re-created:

- Brand collection: `VariableCollectionId:4:2`
- System collection: `VariableCollectionId:4:3`
- Most recent Foundation shell parent page id: `3:3`
- Most recent UDig shell id: `35:136` (likely stale after v4 rebuild — re-query)
- Components page id: `3:2`

When in doubt, call `mcp__figma__get_metadata` against `fileKey: gsnW43uSpvdLpwandZM8Zx` to get the live structure.
