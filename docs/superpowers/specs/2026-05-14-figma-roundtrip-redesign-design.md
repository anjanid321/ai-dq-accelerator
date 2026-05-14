# Figma round-trip redesign — design spec

**Date:** 2026-05-14
**Owner:** Anjani Dabkara
**Status:** Draft — pending implementation plan

## Goal

Move the DQ Accelerator workspace UI into Figma as the design source of truth, iterate visually per workflow stage, then translate approved designs back into the running Next.js app. Deliver a UDig-branded default look that can be reskinned to any client by editing a single config file — fast enough to demo client-specific branding without redeploying.

## Constraints and decisions captured during brainstorming

- **Style scope:** Full visual redesign. Existing UI is reference for what data/controls each screen needs, not a visual baseline to preserve.
- **Visual direction:** Lightly UDig-branded as default. Aesthetic = simple, easy, clean.
- **Client branding:** Must be swappable via a single per-client config file. Used for live demos with prospects/clients (e.g., Tractor Supply).
- **Starting point:** Tokens + workspace shell (TopBar + Stepper + AIPanel) first. Stage screens come after the foundation is real.
- **Round-trip rhythm (Approach C):** Foundation runs as a single tight Figma → code → localhost loop. Stages then run in workflow order, batching code-gen in groups of 2–3 once the rhythm is trusted.
- **Light mode only for v1.** Dark mode deferred.
- **Out of scope for this spec:** `/` landing, `/sessions` list page redesign, mobile/tablet breakpoints, motion design beyond token-level transitions, empty-state illustrations beyond simple icons.

## Section 1 — Round-trip mechanics

For every unit of work (foundation, or a single stage), the cycle is six steps:

1. **Capture current state.** Screenshot the relevant localhost route and read matching component files to inventory the data, controls, and edge cases the screen must support.
2. **Draft in Figma.** Use `use_figma` (Figma Plugin API via MCP) to create a frame on a specific page with tokens applied, layout, components, and realistic example data. Naming convention: `<Section> / <Screen> / <State> / v<n>`.
3. **User reviews in Figma.** User opens file in browser, comments / steers in chat. I iterate by re-running `use_figma`, bumping version (`v2`, `v3`, …). Superseded versions move to page `99 — Archive`, not deleted.
4. **Approval.** "Approved" locks the current version as source of truth for that unit.
5. **Generate code.** Call `get_design_context` on the approved Figma node → returns reference code + screenshot + asset URLs. Translate into edits to existing components in `frontend/components/...`, reusing existing data hooks (`useSession`, `useAIStream`, etc.). Token references become CSS variable references (`var(--color-brand-primary)`) so client-swap works without further wiring.
6. **Verify on localhost.** Refresh and eyeball. Small render issues → fix in code. Design doesn't survive contact with real data → back to Figma.

**Operational notes:**

- `frontend/AGENTS.md` warns Next.js 16 has breaking changes from earlier majors. Before any non-trivial code edit, consult `node_modules/next/dist/docs/` rather than relying on Next 14/15 patterns from training data.
- Multi-state screens (loading / empty / error / streaming) get **separate frames per state**, not Figma component variants. Reason: easier to comment on, easier to diff, maps directly to existing React conditional renders.

## Section 2 — Token architecture

Tokens live in two synchronized places: Figma Variables and CSS variables in code. Same name = same thing in both.

### Two categories

| Category | Themeable per client? | Examples |
|---|---|---|
| **Brand** | Yes | `color-brand-primary`, `color-brand-accent`, `color-brand-on-primary`, `logo`, `displayName`, `faviconUrl`, optional `font-display` |
| **System** | No (same across all brands) | type scale (sizes/weights/line-heights), spacing scale (4/8 step), radius (sm/md/lg/full), elevation/shadows, motion (durations/easings), semantic colors (success/warning/danger/info), neutral grays |

System layer is brand-agnostic by design. A client picks brand colors and logo; they don't pick a spacing system. This is what makes the swap a one-file change.

### In Figma

- One variable collection named `Brand` with **modes**: UDig (default), Tractor Supply (stub second mode), room for more.
- Other collections (`System/Type`, `System/Space`, `System/Radius`, `System/Elevation`, `System/Motion`, `System/Semantic`) are mode-less.
- Switching a frame's `Brand` mode reskins it entirely. This is how the demo reveal works in Figma before code even runs.

### In code

- Tokens land as CSS variables on `:root`, written by a small `<ThemeProvider>` at the top of the app tree.
- Components reference via Tailwind utility classes (`bg-brand-primary`, `border-border-subtle`) whose values resolve to `var(--color-...)` through `tailwind.config.ts`.
- Selection precedence: `?client=<id>` URL param → `NEXT_PUBLIC_CLIENT` env var → `udig` default.

### Adding a client

Drop `themes/<client>.ts` with 3–5 brand colors and a logo path. Drop the logo SVG in `public/logos/`. Add the import to `themes/_registry.ts`. No other code changes.

### Intentional choices

- **Light mode only for v1.** Dark mode is doable later via a `data-theme-mode="dark"` orthogonal axis; deferred.
- **Semantic colors are system-level, not brand-level.** Red-for-danger reads the same in every brand. Clients can override in their config, but the default is shared.
- **UDig brand specifics:** Authoritative colors and type pulled from `anthropic-skills:udig-deck` template when drafting the first Figma frame. If deck palette is too saturated for UI, dial back lightness/saturation while keeping the core hue.

## Section 3 — Figma file structure

Restructure the currently-empty file into six pages:

```
00 — Tokens         Color ramps (UDig + Tractor Supply side-by-side), type specimen, spacing/radius/elevation reference, logo placements
01 — Components     Button, Input, Select, Card, Panel, Section header, Badge, Status chip, Table parts, Stepper item, Toast, Modal shell, TopBar/StepperRail/AIPanel as published components
02 — Foundation     Workspace shell @ 1440×900, then a side-by-side duplicate in Tractor Supply mode (the demo-reveal reference)
03 — Stages         One section per stage (Load, Profile, Explore, Rules, Validate, Triage, Plan, Transform, Scorecard, Pipeline). Each section holds the state variants that screen actually has (default / loading / empty / error / streaming as applicable).
99 — Archive        Superseded versions of frames; not deleted, for comparison
```

**Frame naming:** `<Section> / <Screen> / <State> / v<n>` — e.g., `Stages / Profile / default / v3`.

**Components are published on page `01`** and used as instances elsewhere, mirroring the CSS-variable inheritance in code. A token tweak on a Button propagates to every screen.

**State variants are separate frames, not Figma component variants.** Variants are good for atomic components (Button hover/disabled); they become unreadable at screen scale.

## Section 4 — Workspace shell layout (the first frame to draw)

Three pieces, same anatomy as today, redesigned for brand-swappability and a simpler look.

### TopBar (56px, was 44px)

```
[ LOGO ][ ←Sessions │ filename.csv  ·  18,432 rows · 47 cols ]                  [ Score 87% ]  [ ⋯ ]
```

- **Logo slot.** Currently a hardcoded indigo gradient hex. Becomes `<Logo />` reading `theme.logo`.
- **Breadcrumb.** Same content, less ornate. `/` separator becomes spacing.
- **Metadata.** Single muted line, only after profiling completes (current behavior preserved).
- **Score chip.** Three hard-coded color modes today (`text-success-light`, etc.) → one component reading semantic tokens. Thresholds (≥90, ≥70, else) unchanged.
- **New `⋯` overflow** on the right. Empty in v1; slot for future Export / Share / Reset.

### Stepper rail (200px, was 160px)

```
○ ─ Load          (done)
│
● ─ Profile       (active)
│   "synthesizing…"   ← optional sub-status
│
○ ─ Rules         (locked)
   …
```

- 10 stages unchanged (load, profile, explore, rules, validate, triage, plan, transform, scorecard, pipeline).
- Active dot uses `--color-brand-primary` (replacing today's hardcoded `#6366f1` shadow).
- **Sub-status line** under the active stage, surfacing the current `WAITING_MESSAGES` text. Today that only lives in the AIPanel.
- Past-stage click affordance preserved.

### AIPanel (340px, was 300px)

```
┌────────────────────────────────────┐
│ • AI Activity        [Feed|Terminal]│
├────────────────────────────────────┤
│  ...event feed / terminal...        │
│                                     │
├────────────────────────────────────┤
│  ⏸  Awaiting your approval         │  ← persistent waiting banner
└────────────────────────────────────┘
```

- Feed / Terminal segmented control rebuilt token-driven (replaces nested ad-hoc buttons).
- Status dot is semantic: streaming → success, waiting → warning, idle → muted.
- Waiting banner stays where it is; uses semantic warning surface tokens.

### Main content slot

Flex-1 column between Stepper and AIPanel. The "viewing past stage" warning bar stays where it is, restyled with semantic warning tokens.

### Opinionated cleanup

The current shell mixes `bg-elevated` / `bg-surface` inconsistently and has ad-hoc `bg-indigo/10`, `bg-black/5`, inline hex strings. The redesign **removes all ad-hoc colors from the shell** — every color resolves through a CSS variable. Without this, the client-swap demo silently breaks anywhere a hex is hidden.

## Section 5 — Code integration plan (foundation pass)

**Principle:** no stage component file changes its imports or class names during the foundation pass. We rewire what Tailwind classes resolve to and add the theming plumbing — that's it.

### New files

```
frontend/lib/theme/
  types.ts                  Theme TS type — single source of truth for token shape
  apply.ts                  writeTokensToRoot(theme) — sets CSS vars on :root
  resolve.ts                getActiveTheme() — ?client= → NEXT_PUBLIC_CLIENT → default
  themes/
    udig.ts                 default theme
    tractor-supply.ts       stub demo theme (placeholder colors for v1)
    _registry.ts            { udig, 'tractor-supply' } map

frontend/components/theme/
  ThemeProvider.tsx         Client component; calls writeTokensToRoot on mount + theme change
  Logo.tsx                  Renders theme.logo

frontend/public/logos/
  udig.svg
  tractor-supply.svg
```

### Changed files

| File | Change |
|---|---|
| `app/layout.tsx` | Wrap `<body>` with `<ThemeProvider>`. Add `data-theme` attribute for SSR. |
| `app/globals.css` | Replace 2 ad-hoc vars with full token set under `:root` (UDig defaults as fallback before JS runs). Includes system tokens (spacing, radius, type) as CSS vars. |
| `tailwind.config.ts` | All `colors`, `spacing`, `borderRadius`, `fontSize`, `fontFamily` entries become `var(--…)` references. Some utility classes renamed for consistency (`bg-bg` → `bg-canvas`). |
| `components/workspace/TopBar.tsx` | Drop inline gradient `style={{}}`. Logo becomes `<Logo />`. Score-chip color logic moves to `getScoreVariant()` helper returning a semantic token. |
| `components/workspace/Stepper.tsx` | Replace `bg-indigo`, `bg-indigo/10`, hard `#6366f1` shadow with brand-primary tokens. Add sub-status line slot. |
| `components/ai-panel/AIPanel.tsx` | Segmented control token-driven. Status-dot colors → semantic tokens. |

### Tailwind colors after rewire (illustrative)

```ts
colors: {
  // Brand (themeable)
  'brand-primary': 'var(--color-brand-primary)',
  'brand-accent':  'var(--color-brand-accent)',
  'on-brand':      'var(--color-brand-on-primary)',

  // Surfaces (system)
  canvas:   'var(--color-bg-canvas)',
  surface:  'var(--color-bg-surface)',
  elevated: 'var(--color-bg-elevated)',

  // Text
  fg:           'var(--color-fg-default)',
  'fg-muted':   'var(--color-fg-muted)',
  'fg-inverse': 'var(--color-fg-inverse)',

  // Borders
  border:          'var(--color-border-subtle)',
  'border-strong': 'var(--color-border-strong)',

  // Semantic
  success: 'var(--color-semantic-success)',
  warning: 'var(--color-semantic-warning)',
  danger:  'var(--color-semantic-danger)',
  info:    'var(--color-semantic-info)',
}
```

### A theme value

```ts
export const udig: Theme = {
  id: 'udig',
  displayName: 'UDig',
  logo: { src: '/logos/udig.svg', width: 88, height: 24 },
  faviconUrl: '/favicons/udig.ico',
  brand: { primary: '#1E3A8A', accent: '#F59E0B', onPrimary: '#FFFFFF' },
  // semantic colors omitted → fall back to system defaults
  fontDisplay: undefined,
}
```
(Hex values are illustrative — final UDig brand colors pulled from `anthropic-skills:udig-deck` when the actual frame is drafted.)

### SSR / FOUC

`globals.css :root` ships UDig values as the static default, so first paint is correct for the common case. `ThemeProvider` only overrides if `?client=…` doesn't match UDig. The first paint of a Tractor Supply demo flashes UDig for one frame. Acceptable for v1; can be lifted to a server component reading the URL later if it matters.

### Figma ↔ code symmetry

Figma variable `Brand / primary` (mode UDig → `#1E3A8A`, mode TractorSupply → some other hex) corresponds 1:1 to `theme.brand.primary` in each `themes/<client>.ts`. When `get_design_context` returns code referencing that variable, the translation is a direct substitution.

### What does NOT change in the foundation pass

- No stage component files (`components/stages/*.tsx`).
- No data hooks, API code, Temporal/backend code.
- After the foundation pass, localhost shows the same screens with the same data — but UDig-branded shell, and `?client=tractor-supply` reskins everything.

## Section 6 — Work order

### Round 1 — Foundation (single tight loop)

1. Pull authoritative UDig brand assets (colors, type) from `anthropic-skills:udig-deck` and any existing collateral.
2. Draft Figma page `00 — Tokens` (UDig + Tractor Supply ramps, type, spacing/radius/elevation; `Brand` variable collection with both modes set up).
3. Draft Figma page `01 — Components` with only the shell-relevant components: Logo slot, Stepper item, Score chip, Segmented control, Status dot, Waiting banner. Buttons/inputs deferred to the first stage that actually needs them (YAGNI).
4. Draft Figma page `02 — Foundation` with the workspace shell at 1440×900, then a side-by-side duplicate in Tractor Supply mode (demo-reveal reference).
5. User reviews in Figma. Iterate via `use_figma` until approved.
6. Generate code: new theme files + ThemeProvider + Tailwind rewire + Logo component + the three shell file edits.
7. User verifies on localhost: same screens with new chrome; `?client=tractor-supply` reskins every screen.
8. Commit. Round 1 done.

### Round 2 — Stages (workflow order, tight loop early, batched code-gen later)

| # | Stage | Notes |
|---|---|---|
| 1 | Load | Simplest. Upload affordance + dropzone + loading state. Warm-up. |
| 2 | Profile | Heaviest. Per-column stats, distributions, AI synthesis panel. Sets the pattern for data-dense screens. |
| 3 | Explore | Agent investigation results. Reuses Profile patterns. |
| 4 | Rules | Critical interaction: approve/reject list w/ AI rationale. Sets the human-in-the-loop pattern. |
| 5 | Validate | Validation results table. Mostly composes existing components. |
| 6 | Triage | Same interaction pattern as Rules. Should be fast after Rules. |
| 7 | Plan + PlanReview | Two sub-states of the `plan` stage; design as two frames in same section. |
| 8 | Transform | Code review + execution loop. Probably needs a code-block component. |
| 9 | Scorecard | Results dashboard. Higher visual ambition — the "money shot." |
| 10 | Pipeline | Generated-artifact preview (dbt/Airflow). Composes table + code-block. |

Code-gen runs as a tight per-stage loop through stage 3. From stage 4 onward, batch code-gen in groups of 2–3.

### Gates

- **Gate A — after Round 1 step 6.** Round 2 stage 1 does not start until the Tractor Supply theme swap is verified working on localhost. If theming is broken, every later stage inherits the breakage.
- **Gate B — after Round 2 stage 2 (Profile).** Heaviest screen. If data-density patterns feel wrong, revisit before continuing — cheaper than fixing 8 more stages built on a shaky pattern.
- **Gate C — after Round 2 stage 4 (Rules).** Establishes the human-in-the-loop pattern that Triage and PlanReview reuse.

## Open questions deferred to implementation planning

- Exact UDig brand color values (hex) — pulled at implementation time from `anthropic-skills:udig-deck`.
- Final font choice for body and display — default Inter for body; display chosen based on UDig brand at implementation time.
- Whether to ship a single shared `<SectionHeader>` component now or extract it organically as stages are built.
- Whether the Stepper sub-status line is purely cosmetic or wires into a new `getMicroStageMessage()` helper based on session events.

## Plan scope guidance

This spec describes a multi-round program of work. **The first implementation plan should cover only Round 1 (Foundation)** — steps 1–8 in Section 6. Each later Round 2 stage gets its own plan written when we're ready to start that stage; trying to plan all 10 stages up front would over-commit before the foundation has validated the toolchain and visual direction.

Batching code-gen for stages 4–10 (mentioned in Section 6) is an explicit human-confirmed decision per batch, not an automatic shift. The plan writer should not assume batching.
