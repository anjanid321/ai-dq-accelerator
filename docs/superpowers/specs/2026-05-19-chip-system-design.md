# Chip System — Design Spec

**Date:** 2026-05-19
**Predecessors:** Round 2 / Stages 1–6 + Upload Modal mini-stage. This is a cross-cutting consolidation, not a new stage.

---

## Goal

Replace 9 ad-hoc chip implementations across the frontend (Score chip, SessionCard stage chip, Profile alert chip, Round chip, CategoryPill, Validate result chip, file-type chip, AI event badge, DimensionChip) with a single shared `Chip` primitive that exposes three variants — `status`, `neutral`, `score` — so the visual vocabulary is consistent and Figma can be updated against a known surface.

Bundle two related fixes in scope since we're touching every consumer anyway:
1. **WCAG AA contrast fix** for the `bg-{tone}/15 + text-{tone}-deep` palette. success-deep and warning-deep currently sit at 4.08–4.47 on the lightest workspace surface — just under AA's 4.5 floor. Darken both tokens one Tailwind tier (700 → 800) so every soft-fill chip clears AA cleanly.
2. **Title Case messaging** on every chip label. Today the AI event badges, Validate result chips, and SessionCard chips mix all-caps + Title Case freely. Title-case them all (`Tool Call`, `Failed · 152`, `Eval Error`, `Awaiting Rules`, etc.).

---

## Out of scope

- New chip semantics. No new tones, no new variants beyond the three established here, no new sizes.
- Other typography work. Section labels (`text-xs font-semibold uppercase tracking-wider`) and the AI prose `✦ ANALYSIS` micro-caps are *not* chips — they stay as-is.
- Button refactor. The existing button vocabulary (primary navy + neutral secondary + compact secondary) already shares structure across stages and isn't ambiguous.
- Score chip's intentional distinct shape (`rounded-full`, outline-only). User explicitly chose to keep it visually distinct from the rest of the chip family. Stays.
- Updating Figma frames. User is updating Figma in parallel against the new convention.
- Backend changes. The chip labels are derived from front-end-side string mappings (`STAGE_LABELS`, alert types from the profiler, hardcoded literals on the AI events and Validate result chips). No new API fields needed.

---

## Background

### Inventory (9 distinct chip implementations today)

| # | Component / file | Use case | Today's class string |
|---|---|---|---|
| 1 | `TopBar.tsx:61` | Quality score readout in TopBar | `bg-surface border rounded-full px-2.5 py-0.5 text-xs font-semibold border-{tone} text-{tone}-deep` |
| 2 | `SessionCard.tsx:103` | Workflow stage status on a session card | `inline-flex px-2 py-1 rounded-md text-[11px] font-semibold tracking-tight bg-{warning,info,success}/15 text-{tone}-deep` |
| 3 | `_profile/AlertRow.tsx` | Profile alert type chip (Missing, etc.) | `text-[11px] font-semibold px-2 py-0.5 rounded-md bg-{tone}/15 text-{tone}-deep` (via `chipClasses(type)` helper) |
| 4 | `ExplorationStage.tsx:127` | Round counter in Explore header | `inline-flex px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted` |
| 5 | `ValidateStage.tsx CategoryPill` | Category score breakdown (validity 78%) | `inline-flex gap-1.5 px-2 py-0.5 rounded-md bg-elevated text-[11px] text-fg-muted border border-border` + inner `text-fg font-semibold` value span |
| 6 | `ValidateStage.tsx RuleCard` | PASSED / FAILED · N / EVAL ERROR | `bg-{tone}/15 text-{tone}-deep border border-{tone}/30 text-[11px] font-semibold px-2 py-0.5 rounded-md` |
| 7 | `UploadModal.tsx:122` | Accepted file-type chips (`.csv` etc.) | `inline-flex px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted` |
| 8 | `EventFeed.tsx:19` | AI event-kind badge (TOOL CALL etc.) | `inline-flex text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide bg-{tone}/15 text-{tone}-deep` |
| 9 | `dq/DimensionChip.tsx:14` | DQ dimension chip in rule filters | `inline-flex px-2 py-1 rounded-md text-[12px] font-medium tracking-tight bg-{tone}/15 text-{tone}-deep` |

### Inconsistencies

- **Padding:** `px-2 py-0.5` (most), `px-2 py-1` (#2, #9), `px-2.5 py-0.5` (#1)
- **Text size:** `text-[11px]` (most), `text-[12px]` (#9), `text-[10px]` (#8), `text-xs` (#1)
- **Font weight:** `font-semibold` (most), `font-medium` (#9), unspecified (#5)
- **Border on status chips:** yes (#6), no (#2, #3, #8, #9)
- **Tracking:** none (most), `tracking-tight` (#2, #9), `tracking-wide` (#8)
- **Shape:** `rounded-md` (most), `rounded-full` (#1), `rounded` (#8)
- **Font family:** sans (most), `font-mono` (#8)
- **Case:** as-written (most), `uppercase` (#8) plus inconsistent capitalization across hardcoded labels

### Locked decisions from brainstorming

1. **Status chips have NO border.** Matches today's majority pattern (#2, #3, #8, #9). Validate result chip (#6) loses its `border-{tone}/30` outline.
2. **AI event badges unify with status chips.** Drop `font-mono`, `uppercase`, and `tracking-wide`. Match the other status chips byte-for-byte.
3. **TopBar Score chip keeps the distinct outline-only `rounded-full` pill.** Intentional exception, lives as its own variant.
4. **WCAG AA fix bundled in.** `success-deep` and `warning-deep` darken one Tailwind tier.
5. **Title Case throughout.** All chip messaging becomes Title Case. Excludes technical literals like `.csv` filenames and percentage values.

---

## Design

### Primitive

`frontend/components/ui/Chip.tsx` exports a single `Chip` component with three discriminated-union variants.

```tsx
export type StatusTone =
  | 'success' | 'warning' | 'danger' | 'info'
  | 'accent-purple' | 'accent-indigo' | 'neutral'

export type ScoreTone = 'success' | 'warning' | 'danger'

type StatusProps  = { variant: 'status';  tone: StatusTone; children: ReactNode; className?: string }
type NeutralProps = { variant: 'neutral'; children: ReactNode; value?: ReactNode; className?: string }
type ScoreProps   = { variant: 'score';   tone: ScoreTone;  children: ReactNode; className?: string }

type Props = StatusProps | NeutralProps | ScoreProps

export function Chip(props: Props) { /* … */ }
```

API examples:

```tsx
<Chip variant="status" tone="success">Passed</Chip>
<Chip variant="status" tone="danger">Failed · 152</Chip>
<Chip variant="status" tone="warning">Eval Error</Chip>
<Chip variant="status" tone="accent-purple">Thinking</Chip>
<Chip variant="status" tone="neutral">Done</Chip>

<Chip variant="neutral">Round 1 of 3</Chip>
<Chip variant="neutral">.csv</Chip>
<Chip variant="neutral" value="78%">validity</Chip>

<Chip variant="score" tone="success">Score: 82%</Chip>
```

### Variant — `status`

Semantic-colored soft-fill chip. No border. Used for stage statuses, alert types, validation results, AI event kinds, DQ dimensions.

```
inline-flex items-center
px-2 py-0.5
rounded-md
text-[11px] font-semibold
bg-{tone}/15
text-{tone}-deep
```

| `tone` | `bg` / `text` |
|---|---|
| `success` | `bg-success/15 text-success-deep` |
| `warning` | `bg-warning/15 text-warning-deep` |
| `danger` | `bg-danger/15 text-danger-deep` |
| `info` | `bg-info/15 text-info-deep` |
| `accent-purple` | `bg-accent-purple/15 text-accent-purple-deep` |
| `accent-indigo` | `bg-accent-indigo/15 text-accent-indigo-deep` |
| `neutral` | `bg-fg-subtle/15 text-fg-muted` |

### Variant — `neutral`

Neutral elevated chip with a 1px border. Used for label-only counters and labelled-value pairs. Optional `value` prop renders a second `text-fg font-semibold` span inside the same chip, separated by `gap-1.5`.

```
inline-flex items-center
px-2 py-0.5
rounded-md
text-[11px] font-semibold
bg-elevated
border border-border
text-fg-muted
```

When `value` is provided:

```
gap-1.5   (added to the chip)
+ <span>{children}</span>
+ <span class="text-fg">{value}</span>
```

The chip stays font-semibold throughout; the label is `text-fg-muted` and the value is `text-fg`. The value span inherits `font-semibold` from the parent.

### Variant — `score`

Outline-only pill. Used only on the TopBar score readout. Intentional exception kept distinct from `status`.

```
inline-flex items-center
bg-surface
border border-{tone}
rounded-full
px-2.5 py-0.5
text-xs font-semibold
text-{tone}-deep
```

| `tone` | thresholds |
|---|---|
| `success` | ≥ 90% |
| `warning` | ≥ 70% |
| `danger` | < 70% |

The `tone`-deep text on `bg-surface` is already AA-clean for all three tones (5.02 / 5.02 / 6.47).

### WCAG AA fix — deep token shift

`frontend/app/globals.css` — two token values change.

```
--color-semantic-success-deep: 22 101 52;   /* #166534 — was 21 128 61 / #15803D */
--color-semantic-warning-deep: 146 64 14;   /* #92400E — was 180 83 9  / #B45309 */
```

Effect on `bg-{tone}/15` + `text-{tone}-deep` chips, computed over the lightest workspace surface family (bg-canvas / bg-surface / bg-elevated):

| Tone | Before | After | Status |
|---|---|---|---|
| success | 4.08–4.40 | 5.80–6.26 | ✓ AA |
| warning | 4.13–4.47 | 5.83–6.31 | ✓ AA |
| danger | 4.88–5.32 | 4.88–5.32 (unchanged) | ✓ AA |
| info | 5.21–5.64 | 5.21–5.64 (unchanged) | ✓ AA |
| accent-purple | 6.41–6.95 | 6.41–6.95 (unchanged) | ✓ AA |
| accent-indigo | 7.60–8.23 | 7.60–8.23 (unchanged) | ✓ AA |

Token shift propagates to every existing usage of `text-success-deep` and `text-warning-deep` — counts rows in Validate, left-border accents on rule cards, AI summary card prose, Score chip border. All cases are strict improvements (text is darker → higher contrast everywhere).

### Title Case convention

All chip messaging is Title Case. Definitions:

- **Title Case applies to:** every status chip label and every neutral chip label that's natural language.
- **Excludes (stay lowercase / as-is):**
  - File extensions in file-type chips: `.csv`, `.parquet`, `.json`
  - Percentages / counts inside the `value` slot of neutral chips: `78%`, `100%`
  - Category names rendered via CSS `capitalize` on the existing CategoryPill — keeping `capitalize` is fine since the labels are single words (`validity`, `consistency`), so the rendered output is Title Case anyway. The chip primitive does NOT apply `capitalize` globally.

### Per-call-site changes

| Site | Today's label | After |
|---|---|---|
| `TopBar` Score | `Score: 82%` | `Score: 82%` (unchanged) |
| `SessionCard` stage | from `STAGE_LABELS` (already Title Case) | unchanged content, switches variant API |
| `AlertRow` Profile alert type | `Missing` / `High Cardinality` / `Type Mismatch` / etc. (already Title Case) | unchanged content |
| `ExplorationStage` Round | `Round 1 of 3` | unchanged content |
| `ValidateStage` CategoryPill | `validity 78%` (with `capitalize` CSS) | unchanged content (CSS still renders Title Case) |
| `ValidateStage` result chip | `PASSED` / `FAILED · 152` / `EVAL ERROR` | `Passed` / `Failed · 152` / `Eval Error` |
| `UploadModal` file-type | `.csv` / `.parquet` / `.json` | unchanged content |
| `EventFeed` AI event | `TOOL CALL` / `RESULT` / `THINKING` / `DONE` / `TOOL RESULT` | `Tool Call` / `Result` / `Thinking` / `Done` / `Tool Result` |
| `DimensionChip` | (varies — from `dimensionTokens(dimension).label`, already Title Case) | unchanged content |

---

## Components / file map

```
frontend/
  components/
    ui/
      Chip.tsx                                 # NEW — primitive
    workspace/
      TopBar.tsx                               # MODIFY — Score → <Chip variant="score">
    sessions/
      SessionCard.tsx                          # MODIFY — stage → <Chip variant="status">
      UploadModal.tsx                          # MODIFY — file-type chips → <Chip variant="neutral">
    stages/
      ExplorationStage.tsx                     # MODIFY — Round → <Chip variant="neutral">
      ValidateStage.tsx                        # MODIFY — CategoryPill + RuleCard chip → <Chip>
      _profile/
        AlertRow.tsx                           # MODIFY — alert-type chip → <Chip variant="status">
        chip-classes.ts                        # MODIFY — replace className output with tone-mapping helper
    ai-panel/
      EventFeed.tsx                            # MODIFY — event badges → <Chip variant="status">, drop badgeBase const
    dq/
      DimensionChip.tsx                        # MODIFY — thin wrapper that resolves dimensionTokens → <Chip>
  app/
    globals.css                                # MODIFY — success-deep + warning-deep token shift
    demo/
      chips/page.tsx                           # DELETE — drop before tag
  __tests__/
    ui/
      Chip.test.tsx                            # NEW — variant + tone tests
```

The existing `chip-classes.ts` helper in `_profile/` currently returns a class string (`bg-warning/15 text-warning-deep`). It becomes a pure tone-mapping helper: `chipTone(type: string): StatusTone`. The callers (`AlertRow`) read the returned tone and pass it to `<Chip variant="status" tone={chipTone(type)}>`.

The existing `dimensionTokens(dimension)` lookup in `lib/dq/dimensions.ts` returns `{ label, fillClass, textClass }`. After the refactor `DimensionChip` only reads `label` + a new `tone` field (added to the return shape). The `fillClass`/`textClass` fields can be removed once `DimensionChip` is the only consumer — verify before deletion.

---

## Behavior matrix

| Variant | When to use |
|---|---|
| `status` | The chip communicates a *state* or *kind* with semantic meaning. Tone choice carries information (success = good, danger = bad, info = neutral classification, etc.). |
| `neutral` | The chip is a *label* or *counter* with no semantic meaning. Rendered with the same shape but neutral fill + border so it doesn't compete with status chips. |
| `score` | TopBar score readout only. Intentional exception. |

When in doubt between `status` and `neutral`: if removing the color would lose information, it's `status`. If the color is purely decoration, it's `neutral`.

---

## Testing strategy

### `Chip.test.tsx` (~12 assertions)

- Renders status variant with the correct `bg-{tone}/15 + text-{tone}-deep` classes for each tone (parameterized with `it.each`).
- Renders neutral variant with `bg-elevated + border-border + text-fg-muted`.
- Renders neutral variant with the `value` slot — child + value spans both present, `gap-1.5` applied.
- Renders score variant with `rounded-full + bg-surface + border-{tone} + text-{tone}-deep`.
- Does NOT render a `value` span when `value` is undefined.
- Passes through `className` for custom additions.
- TypeScript discriminated union enforces required props per variant (compile-time check, no runtime test needed).

### Per-call-site test updates

Existing tests (`__tests__/stages/{Profile,Explore,Validate,UploadModal}.test.tsx`, plus `EventFeed.test.tsx` if it exists) that assert on chip class strings need to be updated for the new tokens. Changes:

- Validate result chip: drop `border border-{tone}/30` from assertions (now no border).
- AI event badges in `EventFeed.test.tsx` (if any): expect `text-[11px] font-semibold` instead of `text-[10px] font-mono uppercase`.
- SessionCard stage chip: drop `tracking-tight + px-2 py-1`, expect `px-2 py-0.5`.
- DimensionChip: expect `text-[11px] font-semibold` instead of `text-[12px] font-medium`.
- Validate result chip TEXT: assertions on `FAILED · 152` → `Failed · 152`, `PASSED` → `Passed`, `EVAL ERROR` → `Eval Error`.
- AI event badge TEXT: `TOOL CALL` → `Tool Call`, etc.

### Full suite baseline

Going in: 190 passing / 1 failing (the documented `useAIStream` red).
Expected after the refactor: ~200 passing / 1 failing (+12 Chip primitive tests, with existing assertions updated rather than added).

---

## Open notes

- **AI panel border colors:** the EventFeed `EventCard`s currently use `border-{tone}` (e.g. `border-accent-indigo`) on the *card itself* for the highlighted state. These card-level border tokens are separate from the chip — they stay as-is. Only the chip inside the card changes.
- **`chip-classes.ts` rename optional:** the file becomes a tone-mapping helper rather than a class-string helper. The filename can stay `chip-classes.ts` (less churn) or move to `alert-tone.ts` (more accurate). Keep as-is in this refactor — separate rename can come later if it bothers anyone.
- **Borderline a11y on accent-deep tokens:** the Tailwind hex values for `accent-purple-deep` (#6B21A8) and `accent-indigo-deep` (#3730A3) clear AA by a comfortable margin (6.41+ and 7.60+). No change needed.
- **Future tones:** if a future stage needs a new semantic (e.g. `accent-teal`), add the token to `globals.css` and `tailwind.config.ts`, then extend the `StatusTone` union. The primitive doesn't need other changes.

---

## Success criteria

1. `frontend/components/ui/Chip.tsx` exists with the three-variant API documented above.
2. Every chip-shaped element across the 8 modified files renders via `<Chip>`. No `inline-flex px-* py-* rounded-md bg-{tone}/15 text-{tone}-deep` ad-hoc class strings remain except inside `Chip.tsx`.
3. `frontend/app/globals.css` has the darker success-deep + warning-deep values.
4. All AI event labels and Validate result labels render in Title Case (`Tool Call`, `Failed · 152`, `Eval Error`, etc.).
5. `npx tsc --noEmit` clean.
6. Full Jest suite at the documented baseline (1 failing — the pre-existing useAIStream red). Chip primitive tests pass.
7. `npm run build` succeeds.
8. `/demo/chips` route deleted before the tag commit.
9. Tag `chip-system-v1` lands on the cleanup commit.

---

## Commit cadence

1. `feat(ui): add Chip primitive with status / neutral / score variants` — primitive + tests.
2. `style(tokens): darken success-deep + warning-deep to clear WCAG AA on /15 fills` — globals.css token shift. Split from the refactor so the token change is reviewable in isolation. (May land first or last — doesn't matter since the primitive uses the tokens by reference.)
3. `refactor(chips): migrate every call site to Chip primitive + title-case labels` — single mechanical-but-broad commit since the changes are parallel across 8 files. Touches tests for the updated assertions.
4. `chore(preview): remove /demo/chips showcase` — drop the temporary route before tagging.
5. Tag `chip-system-v1` on commit #4.
