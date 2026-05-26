# Figma Sync Handoff — Starting with Tokens + Chip Component (2026-05-26)

This doc hands off to a fresh Claude session to begin the Figma sync work.
Read it top-to-bottom before doing anything else.

---

## TL;DR for the next session

The Figma file `gsnW43uSpvdLpwandZM8Zx` is way behind the `/demo` route. An
audit (2026-05-26) found:

- Figma has **only one page**: `00 — Tokens`. The `02 — Foundation` page
  referenced in prior session handoffs does not exist in the current file.
- Base color tokens are present and match the demo.
- The entire **"deep" + accent token layer is missing** (success-deep,
  warning-deep, danger-deep, info-deep, accent-purple, accent-purple-deep,
  accent-indigo, accent-indigo-deep, fg-inverse).
- No stage frames exist. No `Chip` component exists.

**The user wants to start with the foundation (steps 1–3 from the recommended
order):**
1. Add the missing deep/accent/inverse token variables to `00 — Tokens`,
   normalize naming at the same time
2. Create the `02 — Foundation` page (empty canvas)
3. Build the `Chip` component on the Tokens page (3 variants, all tones)

That's it for this session. Stages 4+ (workspace shell + per-stage frames)
come in a future session once the foundation is in place. Estimated work:
~35 minutes of Figma MCP operations.

---

## Where you are in the bigger arc

The Round 2 frontend redesign is feature-complete in code on the
`round-2-redesign` branch. The `/demo` route walks all 9 redesigned stages
plus the workspace shell. The Figma file lags far behind. This is the
first of multiple Figma sync sessions.

Full sync order (you're doing the first 3 in this session):

| Step | Task | Approx time |
|---|---|---|
| 1 | Add missing deep/accent tokens to `00 — Tokens` | ~15 min |
| 2 | Create `02 — Foundation` page (empty) | ~2 min |
| 3 | Build `Chip` component with all variants | ~20 min |
| 4 | Build `Stepper` + `TopBar` + `AIPanel` shell components | ~30 min (future) |
| 5 | Validate frame | ~45 min (future) |
| 6 | Triage frame | ~45 min (future) |
| 7 | Rules frame | ~30 min (future) |
| 8 | Profile frame | ~20 min (future) |
| 9 | Plan / Transform / Scorecard / Pipeline frames | ~1 hr each (future) |

This session ships steps 1–3. Don't attempt anything past step 3 unless the
user explicitly asks.

---

## Where everything lives

| Asset | Location |
|---|---|
| Git worktree | `/Users/anjani.dabkara/ai-dq-accelerator/.claude/worktrees/strange-leakey-efbec6` |
| Git branch | `round-2-redesign` |
| Figma file key | `gsnW43uSpvdLpwandZM8Zx` |
| Figma file URL | `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx/DQ-Accelerator` |
| Current tokens (CSS) | `frontend/app/globals.css` |
| Chip primitive (React) | `frontend/components/ui/Chip.tsx` |
| Demo entry point | `frontend/app/demo/page.tsx` |
| Earlier audit (this session) | (in chat history; the relevant points are duplicated below) |

---

## Figma MCP tools you need

Search via `ToolSearch` with this exact query to load all the Figma MCP
tools at once:

```
select:mcp__6fb33dc5-0ac1-47a6-8ad6-39f8ec8cfc71__use_figma,mcp__6fb33dc5-0ac1-47a6-8ad6-39f8ec8cfc71__get_metadata,mcp__6fb33dc5-0ac1-47a6-8ad6-39f8ec8cfc71__get_screenshot,mcp__6fb33dc5-0ac1-47a6-8ad6-39f8ec8cfc71__get_variable_defs
```

If you need more (create_new_file, get_libraries, add_code_connect_map,
etc.), search for them with similar `select:` syntax. The MCP slug
`mcp__6fb33dc5-0ac1-47a6-8ad6-39f8ec8cfc71__*` is the installed Figma MCP.

---

## Figma quirks to respect (learned the hard way in earlier sessions)

1. **`strokeOpacity` is NOT valid on FRAME nodes.** Use opacity baked into the
   SolidPaint instead: `{ type: 'SOLID', color, opacity: 0.3 }`.
2. **`layoutSizingHorizontal: 'FILL'` can only be set AFTER appending the node
   to a parent auto-layout frame, not in the constructor.**
3. **For body containers with VERTICAL children of explicit width:** set
   `primaryAxisSizingMode = 'FIXED'` + `counterAxisSizingMode = 'FIXED'` on
   the parent, then `layoutSizingHorizontal = 'FIXED'` +
   `layoutSizingVertical = 'FIXED'` + `resize(w, h)` on each child after
   appending.
4. **Don't use raw hex anywhere.** Bind every color to a foundation variable
   via the Figma variable system. If a needed token doesn't exist yet, create
   it first.

---

## Step 1: Add missing tokens to `00 — Tokens`

### What to do

Add 9 new color variables to the existing variable collection on the
`00 — Tokens` page. These all already have base counterparts (e.g.,
`success` exists; `success-deep` is what's missing).

### Token values (from `frontend/app/globals.css`)

Look up the exact hex values by reading `globals.css` first — they may
have drifted since this doc was written. The values below were current as
of 2026-05-26.

| Token name (recommended) | Hex value | Used in demo for |
|---|---|---|
| `color/semantic/success-deep` | `#166534` | Chip status success text, score chips, validate counts, footer tallies |
| `color/semantic/warning-deep` | `#92400E` | Chip status warning text, triage proposed threshold, errored rule text |
| `color/semantic/danger-deep` | `#B91C1C` | Chip status danger text, "remove rule" text, decision footer keep button |
| `color/semantic/info-deep` | `#1D4ED8` | Chip status info text |
| `color/accent/purple` | `#9333EA` | AI summary card borders (Profile / Validate / Plan / Scorecard) |
| `color/accent/purple-deep` | `#6B21A8` | AI summary card body text |
| `color/accent/indigo` | `#6366F1` | Plan StepCard type chip, Pipeline artifact icon chips |
| `color/accent/indigo-deep` | `#3730A3` | accent-indigo chip text |
| `color/fg/inverse` | `#FFFFFF` | Text/icons on filled semantic circles (Stepper done/active states) |

### WCAG context (important — don't use the old "lighter" values)

`success-deep` and `warning-deep` were specifically darkened from the
Tailwind-700 stops (`#15803D` / `#B45309`) to the values above so that
soft-fill chips (`bg-success/15 text-success-deep`) clear WCAG AA 4.5:1
on every workspace surface (bg-canvas / bg-surface / bg-elevated). If you
find old values somewhere, replace them.

### Naming normalization (do this at the same time)

Figma's existing variables use mixed naming:

- `color/brand/primary` ✓
- `color/bg/canvas` ✓
- `background/surface` ← inconsistent (should be `color/bg/elevated`)
- `border/default` ← inconsistent (should be `color/border/subtle` or
  similar)
- `color/border/strong` ✓

While adding the new tokens, **rename the inconsistent ones** so every
variable follows the `color/{category}/{name}` pattern:

| Current Figma name | Renamed to |
|---|---|
| `background/surface` (#F1F5F9) | `color/bg/elevated` |
| `border/default` (#E2E8F0) | `color/border/subtle` |

(Don't touch any variable that already follows the `color/...` pattern —
just rename the two outliers and add the new 9.)

If renaming breaks downstream references in Figma, leave the renames
alone and just add the new tokens. The user can clean up naming in a
separate pass.

### Verification

After adding tokens:
1. Call `get_variable_defs` and confirm all 9 new variables resolve to
   the right hex.
2. Confirm the existing brand / bg / fg / border / semantic / mono
   variables still match the codebase values (which they did at audit
   time).

### Don't

- Don't add any other tokens (radius, spacing, type) — those are out of
  scope for this session.
- Don't create swatch frames for the new tokens. That's a polish task
  for a later pass.
- Don't touch the `00 — Tokens` swatch sheets that exist.

---

## Step 2: Create `02 — Foundation` page

### What to do

Create a new empty page named exactly `02 — Foundation` in the Figma
file. Leave it empty for now — frames get built in future sessions.

### Verification

`get_metadata` on the file root should now return two pages:
- `00 — Tokens`
- `02 — Foundation`

### Don't

- Don't add anything to the page yet. No frames, no placeholder content.
  Stage frames come in step 5+ (future session).

---

## Step 3: Build the `Chip` component on `00 — Tokens`

This is the meat of the session. The `Chip` primitive is used by every
stage frame, so it needs to exist before stage frames get built.

### Reference: current Chip implementation in code

The Chip primitive lives at `frontend/components/ui/Chip.tsx`. Read it
in full before building the Figma version. The summary:

**Three variants:**

1. **`status`** — semantic soft-fill chip, no border. Used for stage
   statuses, classification labels, decision results.
   - Class shape: `inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-{tone}/15 text-{tone}-deep`
   - Tones: `success`, `warning`, `danger`, `info`, `accent-purple`,
     `accent-indigo`, `neutral`
   - Tone class mappings:
     - `success`: `bg-success/15 text-success-deep`
     - `warning`: `bg-warning/15 text-warning-deep`
     - `danger`: `bg-danger/15 text-danger-deep`
     - `info`: `bg-info/15 text-info-deep`
     - `accent-purple`: `bg-accent-purple/15 text-accent-purple-deep`
     - `accent-indigo`: `bg-accent-indigo/15 text-accent-indigo-deep`
     - `neutral`: `bg-fg-subtle/15 text-fg-muted`

2. **`neutral`** — neutral elevated chip with a border. Used for round
   counters, file-type chips, category labels. Has an optional `value`
   slot for label+value pairs.
   - Class shape: `inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-elevated border border-border text-fg-muted`
   - With value slot: same class + `gap-1.5` + a second span in
     `text-fg`

3. **`score`** — outline-only rounded-full pill. Used for the TopBar
   score readout and per-step score deltas in Plan/Transform.
   - Class shape: `inline-flex items-center bg-surface border rounded-full px-2.5 py-0.5 text-xs font-semibold`
   - Tones (only 3): `success` (border-success + text-success-deep),
     `warning` (border-warning + text-warning-deep), `danger`
     (border-danger + text-danger-deep)

### How to build it in Figma

Figma components support variants via the Variants feature. Build one
component named `Chip` with the following variant axes:

- **Variant**: `status` | `neutral` | `score`
- **Tone** (only applies to status + score):
  - For `status`: `success` | `warning` | `danger` | `info` |
    `accent-purple` | `accent-indigo` | `neutral`
  - For `score`: `success` | `warning` | `danger`
  - For `neutral`: no tone axis (single appearance) — but if Figma
    requires every variant to share axis values, just leave tone
    unused and pin to `neutral` for that variant.

If variant explosion gets unwieldy, split into THREE separate Figma
components: `Chip / Status`, `Chip / Neutral`, `Chip / Score`. That's
acceptable and may read cleaner in Figma's Assets panel.

### Spec for each variant

**Status chip (each tone):**
- Auto-layout HORIZONTAL, `itemSpacing: 0`, padding `(8 H, 2 V)`
- Corner radius: 6px (matches `rounded-md`)
- Fill: bound to the corresponding `/15` opacity wash. In Figma, this
  is the variable's `SolidPaint` with `opacity: 0.15`.
- Stroke: none
- Text: single text node, font Inter (the body font you'll have set up
  via `--font-inter` — or just use Inter directly), size 12px (matches
  `text-xs`), font weight 600 (matches `font-semibold`), fill bound to
  the corresponding `-deep` variable
- Label placeholder: `Status Label` (Title Case, will be overridden per
  instance)

**Neutral chip:**
- Same shape as status (HORIZONTAL auto-layout, 8 H / 2 V padding, 6px
  radius)
- Fill: `bg-elevated` variable (`#F1F5F9`)
- Stroke: `border` variable (`#E2E8F0`), 1px
- Text: 12px Inter font-weight 600, fill `fg-muted` (`#475569`)
- For the value-slot version, build a SECOND variant labeled "with
  value" that has two text nodes separated by `gap-1.5` (6px
  itemSpacing). The second text node uses `fg` (`#0F172A`) fill.

**Score chip (each tone):**
- HORIZONTAL auto-layout, padding `(10 H, 2 V)` (matches `px-2.5 py-0.5`)
- Corner radius: 9999 (full pill, matches `rounded-full`). Use a very
  high number like 999 in Figma — it caps at `min(width, height) / 2`.
- Fill: `bg-surface` variable (`#FFFFFF`)
- Stroke: 1px, color bound to the matching base tone variable
  (`success` for success score chip, etc.)
- Text: 12px Inter font-weight 600, fill bound to the matching `-deep`
  variable

### Verification

After building:
1. Take a screenshot of the Chip component's component frame via
   `get_screenshot`.
2. Confirm:
   - All status tones render with the right soft-fill + deep text combo
   - The neutral chip has a visible 1px border
   - Score chips are fully rounded (pill-shaped) with outline only
   - Every color is bound to a variable (no raw hex)
   - Text is 12px Inter font-weight 600 across the board

### Don't

- Don't use any text size below 12px. The Chip primitive in code is
  `text-xs` (12px). Earlier Figma builds used 10–11px text — that's now
  banned.
- Don't introduce new tones or shapes the React component doesn't have.
  If you're tempted to add a "purple" status without `-deep`, stop —
  the deep tokens are mandatory.
- Don't build it on the `02 — Foundation` page. Components live on the
  Tokens page; stage frames consume them later.

---

## Quick code references

If you need to verify anything mid-task, these are the files to read.

### `frontend/components/ui/Chip.tsx`

Full source of the Chip primitive. The component logic + class strings
are the source of truth for the Figma component spec.

### `frontend/app/globals.css`

Look at lines ~10–90 for the `--color-*` and `--font-*` variables. The
exact hex values for every token are there. Cross-check against the
"Token values" table above — values may have drifted in the demo since
this doc was written.

### `frontend/components/stages/TriageStage.tsx`

Lines ~80–100 have the `CLASSIFICATION_TONE` and `CLASSIFICATION_LABEL`
maps. Good reference for what Title Case chip labels look like in
practice.

### `frontend/components/stages/ScorecardStage.tsx`

Lines ~70–80 show the status chip in use (`<Chip variant="status"
tone={isApplied ? 'success' : 'danger'}>`). Good reference for the
Title Case constraint and the chip primitive call shape.

---

## When you're done

1. Take a final screenshot of each: the `00 — Tokens` page (showing
   the new tokens visible somewhere — even just via Figma's variable
   panel readout via `get_variable_defs`), and the `02 — Foundation`
   empty page.
2. Report back to the user with:
   - Variable IDs for each of the 9 new tokens (you'll need these in
     future sessions when building stage frames)
   - The Chip component's node ID
   - Any deviations you made from this doc + rationale

3. **Append the variable IDs to this handoff doc** so the future
   stage-frame sessions can grab them. Path:
   `docs/superpowers/context-handoff/2026-05-26-figma-sync-handoff.md`.
   Edit this doc in place — add a "## Figma node IDs (filled in after
   step 3)" section at the bottom with the new IDs. Commit:
   `docs: update Figma sync handoff with new token + Chip component
   node IDs`.

4. Stop. Do not start step 4 (workspace shell components) or any stage
   frame. That's a future session.

---

## Critical caveats

- **Read-only the variable system first.** Before adding any new
  variable, call `get_variable_defs` to confirm the existing variables
  resolve correctly and nothing has changed since the 2026-05-26 audit.
  If something's drifted, surface it before pressing on.
- **No code changes in this branch.** The Figma work is Figma-only.
  Don't modify `frontend/` files. The only repo write is appending the
  node IDs to this handoff doc at the end (step 3 above).
- **The user is non-technical.** Report progress in plain English. No
  jargon about Figma Plugin API internals unless they ask.
- **Existing pending Figma sync chips** (from earlier sessions, see the
  `f6aee0a` handoff and the worktree's spawn history): "Sync chip +
  token changes across Figma frames" and "Mirror Validate card chrome
  to Figma". These were spawned but never executed and are obsoleted
  by the current audit. You can leave them alone; the user will
  dismiss them or they'll naturally roll into the broader sync work
  in future sessions.

---

## To resume in a new session

Open a fresh Claude session in this worktree and say:

> Read `docs/superpowers/context-handoff/2026-05-26-figma-sync-handoff.md`,
> then continue.

That doc (this one) is self-contained. The new session needs nothing
else from the chat history.

Branch sits at the most recent commit on `round-2-redesign`. No
uncommitted code changes expected. Figma file `gsnW43uSpvdLpwandZM8Zx`
has only the `00 — Tokens` page at handoff time.
