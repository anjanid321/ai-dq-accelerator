# Chip System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the showcase Chip primitive to a production component, migrate every chip-shaped consumer to `<Chip>`, title-case all chip messaging, drop the preview route, and tag `chip-system-v1`.

**Architecture:** Two-phase. Phase 1 hardens the existing `frontend/components/ui/Chip.tsx` with tests so it's production-ready. Phase 2 is a single mechanical refactor commit that swaps every call site (TopBar, SessionCard, AlertRow, ExplorationStage, ValidateStage, UploadModal, EventFeed, DimensionChip) to use `<Chip>`, drops dead helpers (`badgeBase` in EventFeed, the className-output mode of `chip-classes.ts`), updates the existing test assertions for the new class-strings + title-case labels, then deletes `frontend/app/demo/chips/page.tsx`. Phase 3 is verification + tag.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4 (foundation tokens), Jest 30 + ts-jest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-19-chip-system-design.md`

**Prior commits already on this branch:**
- `3168fbd chore(preview): add temporary Chip primitive + /demo/chips showcase` — primitive lives at `frontend/components/ui/Chip.tsx`, no production consumers yet.
- `d4c6213 chore(preview): darken success/warning deep tokens for WCAG AA + title-case showcase` — the token shift in `frontend/app/globals.css` is already landed and is production-going (despite the `chore(preview)` label, the showcase commit happened to contain it). No further token work in this plan.

---

## File Structure

```
frontend/
  components/
    ui/
      Chip.tsx                                 # EXISTS — verify spec-compliance (Phase 1)
    workspace/
      TopBar.tsx                               # MODIFY (Phase 2)
    sessions/
      SessionCard.tsx                          # MODIFY (Phase 2)
      UploadModal.tsx                          # MODIFY (Phase 2)
    stages/
      ExplorationStage.tsx                     # MODIFY (Phase 2)
      ValidateStage.tsx                        # MODIFY (Phase 2)
      _profile/
        AlertRow.tsx                           # MODIFY (Phase 2)
        chip-classes.ts                        # MODIFY (Phase 2) — returns tone instead of className
    ai-panel/
      EventFeed.tsx                            # MODIFY (Phase 2) — drop badgeBase, title-case labels
    dq/
      DimensionChip.tsx                        # MODIFY (Phase 2) — wraps <Chip>
  __tests__/
    ui/
      Chip.test.tsx                            # NEW (Phase 1)
    stages/
      _profile/
        chip-classes.test.ts                   # MODIFY (Phase 2) — assert tone return value, not className
        AlertRow.test.tsx                      # MODIFY (Phase 2) — same chip text but classes assert on new primitive
      ExplorationStage.test.tsx                # MODIFY (Phase 2) — Round chip class strings
      ValidateStage.test.tsx                   # MODIFY (Phase 2) — result chip drops `/30 border`, labels are Title Case
      ProfileStage.test.tsx                    # MODIFY (Phase 2) — alert chip class strings (if any directly asserted)
    sessions/
      UploadModal.test.tsx                     # MODIFY (Phase 2) — file-type chip class strings (if any)
  app/
    demo/
      chips/page.tsx                           # DELETE (Phase 3)
```

Commit cadence — three commits + a tag:

1. **`test(ui): add Chip primitive tests`** (Phase 1)
2. **`refactor(chips): migrate every call site to Chip + title-case labels`** (Phase 2)
3. **`chore(preview): remove /demo/chips showcase`** (Phase 3)
4. Tag `chip-system-v1` on commit #3.

---

## Phase 1 — Harden the Chip primitive with tests

The primitive already exists at `frontend/components/ui/Chip.tsx` (committed at `3168fbd`). Verify it matches the spec exactly, then add tests so it's production-ready.

### Task 1.1: Verify the primitive matches the spec

**Files:**
- Read: `frontend/components/ui/Chip.tsx`

- [ ] **Step 1: Open the file and confirm the API matches the spec**

The file should export:

```tsx
export type StatusTone =
  | 'success' | 'warning' | 'danger' | 'info'
  | 'accent-purple' | 'accent-indigo' | 'neutral'
export type ScoreTone = 'success' | 'warning' | 'danger'

export function Chip(props:
  | { variant: 'status';  tone: StatusTone; children: ReactNode; className?: string }
  | { variant: 'neutral'; children: ReactNode; value?: ReactNode; className?: string }
  | { variant: 'score';   tone: ScoreTone;  children: ReactNode; className?: string }
): JSX.Element
```

If any of the following is wrong, fix it in place:

- `StatusTone` includes all 7 tones.
- `ScoreTone` includes 3 tones (success / warning / danger).
- Status base class string is `inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold` plus the tone-specific `bg-{tone}/15 text-{tone}-deep`.
- Neutral base adds `bg-elevated border border-border text-fg-muted` plus `gap-1.5` only when `value` is provided.
- Neutral with `value` renders the value in a second span with `text-fg` (font-semibold is inherited from the chip).
- Score base is `inline-flex items-center bg-surface border rounded-full px-2.5 py-0.5 text-xs font-semibold` plus the tone-specific `border-{tone} text-{tone}-deep`.

If the file is already correct, no edits needed — move to Task 1.2.

### Task 1.2: Write the test file

**Files:**
- Create: `frontend/__tests__/ui/Chip.test.tsx`

- [ ] **Step 1: Create the directory and write the test**

```tsx
// frontend/__tests__/ui/Chip.test.tsx
import { render, screen } from '@testing-library/react'
import { Chip, type StatusTone } from '@/components/ui/Chip'

const STATUS_TONE_EXPECTATIONS: Array<[StatusTone, string, string]> = [
  ['success',        'bg-success/15',        'text-success-deep'],
  ['warning',        'bg-warning/15',        'text-warning-deep'],
  ['danger',         'bg-danger/15',         'text-danger-deep'],
  ['info',           'bg-info/15',           'text-info-deep'],
  ['accent-purple',  'bg-accent-purple/15',  'text-accent-purple-deep'],
  ['accent-indigo',  'bg-accent-indigo/15',  'text-accent-indigo-deep'],
  ['neutral',        'bg-fg-subtle/15',      'text-fg-muted'],
]

describe('Chip', () => {
  describe('variant=status', () => {
    it.each(STATUS_TONE_EXPECTATIONS)(
      'tone=%s applies %s + %s',
      (tone, bgClass, textClass) => {
        render(<Chip variant="status" tone={tone}>Label</Chip>)
        const el = screen.getByText('Label')
        expect(el.className).toContain('inline-flex')
        expect(el.className).toContain('px-2')
        expect(el.className).toContain('py-0.5')
        expect(el.className).toContain('rounded-md')
        expect(el.className).toContain('text-[11px]')
        expect(el.className).toContain('font-semibold')
        expect(el.className).toContain(bgClass)
        expect(el.className).toContain(textClass)
      },
    )

    it('does NOT apply a border class on the status variant', () => {
      render(<Chip variant="status" tone="danger">Failed · 152</Chip>)
      const el = screen.getByText('Failed · 152')
      // Foundation tokens use `border-border` etc. for chrome; status chips shouldn't.
      expect(el.className).not.toContain('border ')
      expect(el.className).not.toMatch(/border-[a-z]+/)
    })
  })

  describe('variant=neutral', () => {
    it('applies bg-elevated + border-border + text-fg-muted without a value slot', () => {
      render(<Chip variant="neutral">Round 1 of 3</Chip>)
      const el = screen.getByText('Round 1 of 3')
      expect(el.className).toContain('bg-elevated')
      expect(el.className).toContain('border')
      expect(el.className).toContain('border-border')
      expect(el.className).toContain('text-fg-muted')
      expect(el.className).toContain('font-semibold')
      // value-only chrome should be absent
      expect(el.className).not.toContain('gap-1.5')
    })

    it('renders the value span with text-fg and applies gap-1.5 when value is provided', () => {
      render(<Chip variant="neutral" value="78%">validity</Chip>)
      const label = screen.getByText('validity')
      const value = screen.getByText('78%')
      // both are inside the same chip
      expect(label.parentElement).toBe(value.parentElement)
      const chip = label.parentElement as HTMLElement
      expect(chip.className).toContain('gap-1.5')
      expect(value.className).toContain('text-fg')
    })
  })

  describe('variant=score', () => {
    it.each<[Exclude<StatusTone, 'info' | 'accent-purple' | 'accent-indigo' | 'neutral'>, string, string]>([
      ['success', 'border-success', 'text-success-deep'],
      ['warning', 'border-warning', 'text-warning-deep'],
      ['danger',  'border-danger',  'text-danger-deep'],
    ])('tone=%s applies %s + %s on the outline pill', (tone, borderClass, textClass) => {
      render(<Chip variant="score" tone={tone}>Score: 82%</Chip>)
      const el = screen.getByText('Score: 82%')
      expect(el.className).toContain('rounded-full')
      expect(el.className).toContain('bg-surface')
      expect(el.className).toContain('px-2.5')
      expect(el.className).toContain('py-0.5')
      expect(el.className).toContain('text-xs')
      expect(el.className).toContain('font-semibold')
      expect(el.className).toContain(borderClass)
      expect(el.className).toContain(textClass)
    })
  })

  describe('className passthrough', () => {
    it('appends a custom className on the status variant', () => {
      render(<Chip variant="status" tone="success" className="ml-2">Done</Chip>)
      expect(screen.getByText('Done').className).toContain('ml-2')
    })

    it('appends a custom className on the neutral variant', () => {
      render(<Chip variant="neutral" className="ml-2">Round 1 of 3</Chip>)
      expect(screen.getByText('Round 1 of 3').parentElement?.className).toContain('ml-2')
    })

    it('appends a custom className on the score variant', () => {
      render(<Chip variant="score" tone="success" className="ml-2">Score: 82%</Chip>)
      expect(screen.getByText('Score: 82%').className).toContain('ml-2')
    })
  })
})
```

- [ ] **Step 2: Run the test, verify it passes**

```bash
cd frontend && npx jest __tests__/ui/Chip.test.tsx
```

Expected: all assertions pass. The primitive was already written; the tests retroactively pin its contract.

If a test fails, fix the primitive — the test is the spec.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit Phase 1**

```bash
git add frontend/__tests__/ui/Chip.test.tsx
git commit -m "$(cat <<'EOF'
test(ui): add Chip primitive tests

Pins the Chip primitive's contract:
- status variant: 7 tones, no border, px-2 py-0.5 rounded-md
  text-[11px] font-semibold + bg-{tone}/15 + text-{tone}-deep
- neutral variant: bg-elevated + border-border + text-fg-muted,
  optional value slot renders text-fg with gap-1.5
- score variant: rounded-full outline-only pill, bg-surface +
  border-{tone} + text-{tone}-deep
- className passthrough on every variant

Promotes the primitive from preview-only to production-ready. No
production callers migrated yet — that's the next commit.
EOF
)"
```

---

## Phase 2 — Migrate every call site

Single broad refactor commit. Mechanical: each consumer swaps its inline class string for `<Chip>` and (where applicable) title-cases its hardcoded labels. Update existing test assertions inline since the class strings are changing.

### Task 2.1: `TopBar` Score chip

**Files:**
- Modify: `frontend/components/workspace/TopBar.tsx`

- [ ] **Step 1: Replace the score chip block**

Find (around lines 12–24, 58–65):

```tsx
import Link from 'next/link'
import { Ellipsis } from 'lucide-react'
import { Logo } from '@/components/theme/Logo'

interface Props {
  filename: string
  rowCount?: number
  colCount?: number
  currentScore?: number
}

export function TopBar({ filename, rowCount, colCount, currentScore }: Props) {
  const pct = currentScore != null ? Math.round(currentScore * 100) : null

  const variant =
    pct === null ? null : pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger'

  const chipClass =
    variant === 'success'
      ? 'border-success text-success-deep'
      : variant === 'warning'
      ? 'border-warning text-warning-deep'
      : 'border-danger text-danger-deep'

  return (
```

Replace the imports + body up to the JSX with:

```tsx
import Link from 'next/link'
import { Ellipsis } from 'lucide-react'
import { Logo } from '@/components/theme/Logo'
import { Chip, type ScoreTone } from '@/components/ui/Chip'

interface Props {
  filename: string
  rowCount?: number
  colCount?: number
  currentScore?: number
}

export function TopBar({ filename, rowCount, colCount, currentScore }: Props) {
  const pct = currentScore != null ? Math.round(currentScore * 100) : null
  const tone: ScoreTone | null =
    pct === null ? null : pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger'

  return (
```

Then replace the score-chip JSX block (around lines 57–65) — find:

```tsx
      {/* Score chip */}
      {pct !== null && variant !== null && (
        <div
          data-variant={variant}
          className={`bg-surface border rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipClass}`}
        >
          Score: {pct}%
        </div>
      )}
```

Replace with:

```tsx
      {/* Score chip */}
      {pct !== null && tone !== null && (
        <Chip variant="score" tone={tone} className="data-variant">
          <span data-variant={tone}>Score: {pct}%</span>
        </Chip>
      )}
```

Wait — `Chip` doesn't pass through arbitrary HTML attributes, only `className`. To preserve `data-variant` on the chip itself, render it via a wrapper or accept a slight loss. Tests for TopBar (if any) probably don't assert on `data-variant`. Verify with:

```bash
grep -n "data-variant" frontend/__tests__ 2>&1 | grep -i topbar
```

If no test asserts on `data-variant`, drop it entirely:

```tsx
      {/* Score chip */}
      {pct !== null && tone !== null && (
        <Chip variant="score" tone={tone}>Score: {pct}%</Chip>
      )}
```

If any test does assert on it, add a `data-variant` prop to the Chip primitive (forwarded to the underlying span) — but that's a Chip-level API change that should land in Phase 1, not here. Most likely no test asserts on it; drop the attribute.

- [ ] **Step 2: Verify build still compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

### Task 2.2: `SessionCard` stage chip

**Files:**
- Modify: `frontend/components/sessions/SessionCard.tsx`

- [ ] **Step 1: Drop the `CHIP_CLASSES` map and use `<Chip>`**

Find (around lines 4–37, 103–111):

```tsx
import type { SessionListEntry } from '@/lib/types'
import { deleteSession, getPipelineDownloadUrl } from '@/lib/api'
import { STAGE_LABELS, stageCategory, stageDetail, type StageCategory } from '@/lib/stages'
```

Add the Chip import:

```tsx
import { Chip, type StatusTone } from '@/components/ui/Chip'
```

Find the `CHIP_CLASSES` constant (around lines 22–26):

```tsx
const CHIP_CLASSES: Record<StageCategory, string> = {
  awaiting: 'bg-warning/15 text-warning-deep',
  progress: 'bg-info/15 text-info-deep',
  complete: 'bg-success/15 text-success-deep',
}
```

Replace with a tone map:

```tsx
const CATEGORY_TONE: Record<StageCategory, StatusTone> = {
  awaiting: 'warning',
  progress: 'info',
  complete: 'success',
}
```

Find the stage-chip JSX (around lines 103–111):

```tsx
        <span
          data-stage-category={category}
          className={[
            'ml-auto inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold tracking-tight shrink-0',
            CHIP_CLASSES[category],
          ].join(' ')}
        >
          {STAGE_LABELS[entry.stage]}
        </span>
```

Replace with:

```tsx
        <Chip
          variant="status"
          tone={CATEGORY_TONE[category]}
          className="ml-auto shrink-0"
        >
          {STAGE_LABELS[entry.stage]}
        </Chip>
```

The `data-stage-category` attribute is dropped. If any test asserts on it, check:

```bash
grep -n "data-stage-category" frontend/__tests__ 2>&1
```

If a test uses it, restore it by passing it as a child wrapper element (don't extend the Chip API — keep it minimal).

### Task 2.3: `AlertRow` profile alert chip

**Files:**
- Modify: `frontend/components/stages/_profile/AlertRow.tsx`
- Modify: `frontend/components/stages/_profile/chip-classes.ts`

- [ ] **Step 1: Convert `chip-classes.ts` from a className-output to a tone-output helper**

Read the existing file to confirm current signature. Then replace its contents with:

```ts
// frontend/components/stages/_profile/chip-classes.ts
import type { StatusTone } from '@/components/ui/Chip'

/**
 * Map a ydata-profiling alert `type` string to the StatusTone used by the
 * Chip primitive. Three buckets:
 *
 *  - Missing / Constant                       → warning (amber)
 *  - High Cardinality / Duplicates / Skewness → info (blue)
 *  - Anything else                            → danger (red, intentional
 *                                               fallback so new alert types
 *                                               still surface visibly)
 *
 * Case-insensitive and null/undefined safe so we don't have to enumerate every
 * upstream variant.
 */
export function chipTone(type: string | null | undefined): StatusTone {
  const t = (type ?? '').toLowerCase()
  if (t.includes('missing') || t.includes('constant')) return 'warning'
  if (t.includes('cardinality') || t.includes('duplicate') || t.includes('skew')) return 'info'
  return 'danger'
}
```

Note the function rename: `chipClasses` → `chipTone`. Update the import in `AlertRow.tsx`.

- [ ] **Step 2: Update `AlertRow.tsx` to use `<Chip>` + the new `chipTone` helper**

Find the existing imports + chip JSX in `AlertRow.tsx`:

```tsx
'use client'
import { chipClasses } from './chip-classes'

export interface AlertEntry { ... }
interface Props { alert: AlertEntry }

export function AlertRow({ alert }: Props) {
  const { column, type, description } = alert
  return (
    <li className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-1.5 list-none">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-fg">{column || 'Table-level'}</span>
        {type && (
          <span className={`${chipClasses(type)} text-[11px] font-semibold px-2 py-0.5 rounded-md`}>
            {type}
          </span>
        )}
      </div>
      {description && <p className="text-xs text-fg-muted leading-relaxed">{description}</p>}
    </li>
  )
}
```

Replace with:

```tsx
'use client'
import { Chip } from '@/components/ui/Chip'
import { chipTone } from './chip-classes'

export interface AlertEntry {
  column?: string
  type?: string
  description?: string
}

interface Props {
  alert: AlertEntry
}

export function AlertRow({ alert }: Props) {
  const { column, type, description } = alert
  return (
    <li className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-1.5 list-none">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-fg">{column || 'Table-level'}</span>
        {type && (
          <Chip variant="status" tone={chipTone(type)}>{type}</Chip>
        )}
      </div>
      {description && <p className="text-xs text-fg-muted leading-relaxed">{description}</p>}
    </li>
  )
}
```

- [ ] **Step 3: Update `chip-classes.test.ts` to assert on tone**

Find the existing tests at `frontend/__tests__/stages/_profile/chip-classes.test.ts`. Replace the assertions:

- `expect(chipClasses(input)).toContain('bg-warning/15')` → `expect(chipTone(input)).toBe('warning')`
- `expect(chipClasses(input)).toContain('text-warning-deep')` → (covered by `toBe('warning')` — remove the second assertion)
- Same for info / danger buckets.
- Update the import: `import { chipTone } from '@/components/stages/_profile/chip-classes'`
- Update the `describe`/`it` titles from "chipClasses" to "chipTone".

The full replacement test file:

```ts
// frontend/__tests__/stages/_profile/chip-classes.test.ts
import { chipTone } from '@/components/stages/_profile/chip-classes'

describe('chipTone', () => {
  describe('warning bucket', () => {
    it.each(['Missing', 'missing', 'MISSING', 'Constant', 'constant'])(
      'maps %s to warning',
      (input) => {
        expect(chipTone(input)).toBe('warning')
      },
    )
  })

  describe('info bucket', () => {
    it.each(['High Cardinality', 'high cardinality', 'Duplicates', 'Skewness', 'Skew'])(
      'maps %s to info',
      (input) => {
        expect(chipTone(input)).toBe('info')
      },
    )
  })

  describe('danger bucket', () => {
    it.each(['Type Mismatch', 'Some Future Alert', 'unknown', ''])(
      'maps %s (unrecognized) to danger',
      (input) => {
        expect(chipTone(input)).toBe('danger')
      },
    )

    it('handles null and undefined safely', () => {
      expect(chipTone(null)).toBe('danger')
      expect(chipTone(undefined)).toBe('danger')
    })
  })
})
```

- [ ] **Step 4: Update `AlertRow.test.tsx` for the new chip class strings**

Find the existing assertions in `frontend/__tests__/stages/_profile/AlertRow.test.tsx`. The text-based assertions (`screen.getByText('Missing')` etc.) still work — only update class-based assertions that target the chip:

- Existing assertions like `expect(chip.className).toContain('text-warning-deep')` and `expect(chip.className).toContain('bg-warning/15')` still pass — the Chip primitive emits both. Keep these.
- If any assertion checks for `text-[11px] font-semibold px-2 py-0.5 rounded-md` explicitly, it still passes — those are part of the primitive's status base.
- If an assertion checks for `border` on the chip, it now fails (status has no border). Remove those assertions.

Walk through the file and verify by running it after edits.

### Task 2.4: `ExplorationStage` Round chip

**Files:**
- Modify: `frontend/components/stages/ExplorationStage.tsx`

- [ ] **Step 1: Use `<Chip variant="neutral">` for the Round chip**

Find (around line 127):

```tsx
          {state && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted">
              Round {state.investigation_round + 1} of 3
            </span>
          )}
```

Replace with:

```tsx
          {state && (
            <Chip variant="neutral">
              Round {state.investigation_round + 1} of 3
            </Chip>
          )}
```

Add the import at the top:

```tsx
import { Chip } from '@/components/ui/Chip'
```

- [ ] **Step 2: Update `ExplorationStage.test.tsx` assertion for the Round chip**

Find the existing test that asserts on the Round chip. It probably reads the text "Round N of 3" via `screen.getByText`, which still works. If it asserts on `text-[11px] font-semibold text-fg-muted bg-elevated border-border` explicitly, those classes are still applied by the Chip primitive — keep.

### Task 2.5: `ValidateStage` — both CategoryPill and result chips

**Files:**
- Modify: `frontend/components/stages/ValidateStage.tsx`
- Modify: `frontend/__tests__/stages/ValidateStage.test.tsx`

- [ ] **Step 1: Replace the `CategoryPill` helper with `<Chip variant="neutral" value="X%">…`**

Find the existing `CategoryPill` function (around lines 9–17):

```tsx
function CategoryPill({ label, score }: { label: string; score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-elevated text-[11px] text-fg-muted border border-border">
      <span className="capitalize">{label}</span>
      <span className="font-semibold text-fg">{Math.round(score * 100)}%</span>
    </span>
  )
}
```

Replace with:

```tsx
function CategoryPill({ label, score }: { label: string; score: number }) {
  return (
    <Chip variant="neutral" value={`${Math.round(score * 100)}%`}>
      <span className="capitalize">{label}</span>
    </Chip>
  )
}
```

- [ ] **Step 2: Replace the result-chip block in `RuleCard`**

Find the existing chipClasses ternary + chip span (around lines 70–95). The current code is:

```tsx
  const chipClasses = hasError
    ? 'bg-warning/15 text-warning-deep border border-warning/30'
    : failed
      ? 'bg-danger/15 text-danger-deep border border-danger/30'
      : 'bg-success/15 text-success-deep border border-success/30'
```

and later:

```tsx
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${chipClasses}`}
          >
            {hasError ? 'EVAL ERROR' : failed ? `FAILED · ${rule.failure_count}` : 'PASSED'}
          </span>
```

Replace BOTH the `chipClasses` const and the `<span>` with a tone-resolving call to `<Chip>`:

```tsx
  const resultTone: StatusTone = hasError ? 'warning' : failed ? 'danger' : 'success'
  const resultLabel = hasError
    ? 'Eval Error'
    : failed
      ? `Failed · ${rule.failure_count}`
      : 'Passed'
```

and:

```tsx
          <Chip variant="status" tone={resultTone}>{resultLabel}</Chip>
```

Remove the entire `chipClasses` const — it's no longer used.

Add the import at the top of the file:

```tsx
import { Chip, type StatusTone } from '@/components/ui/Chip'
```

- [ ] **Step 3: Update `ValidateStage.test.tsx` for the new result-chip class strings + title-case**

Find every assertion on the result chip text and update for Title Case:

- `getByText('PASSED')` → `getByText('Passed')`
- `getByText(/FAILED · 6/)` → `getByText(/Failed · 6/)` or `getByText(/Failed · \d+/)`
- `getByText('EVAL ERROR')` → `getByText('Eval Error')`

Find every class-string assertion on the result chips and remove the `/30 border` checks (the Chip primitive doesn't emit a border on status chips):

- `expect(chip.className).toContain('border')` → REMOVE
- `expect(chip.className).toContain('border-{semantic}/30')` → REMOVE

The other assertions (`bg-success/15`, `text-success-deep`, etc.) still pass.

Similarly for the CategoryPill assertions — the new structure has the label span and value span as siblings inside the Chip. Existing text-based assertions (`screen.getByText('validity')`) still work; class-string assertions on the outer chip still work since neutral chips have `bg-elevated + border-border + text-fg-muted + font-semibold`. The value span now has `text-fg` (not `font-semibold text-fg` since semibold is inherited).

If any test asserts on the value span's `font-semibold` class directly, it'll still pass because the primitive's neutral variant declares `font-semibold` on the OUTER chip; computed inheritance makes the value span effectively semibold. CSS class assertions check classNames, not computed styles, so any specific assertion targeting the value span's `font-semibold` className will fail. If you find such an assertion, drop it — the visual outcome is unchanged.

### Task 2.6: `UploadModal` file-type chips

**Files:**
- Modify: `frontend/components/sessions/UploadModal.tsx`

- [ ] **Step 1: Replace the file-type chip block**

Find (around lines 119–127):

```tsx
            <div className="flex items-center gap-1.5 mt-1">
              {ACCEPTED_TYPES.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted"
                >
                  {t}
                </span>
              ))}
            </div>
```

Replace with:

```tsx
            <div className="flex items-center gap-1.5 mt-1">
              {ACCEPTED_TYPES.map((t) => (
                <Chip key={t} variant="neutral">{t}</Chip>
              ))}
            </div>
```

Add the import at the top:

```tsx
import { Chip } from '@/components/ui/Chip'
```

- [ ] **Step 2: Update `UploadModal.test.tsx` if any chip assertions exist**

Walk the test file. If existing assertions check for `bg-elevated + border-border + text-fg-muted` on the file-type chips, they still pass — the Chip primitive emits these. If any assertion targets the wrapping `<span>` element class string explicitly (e.g., `inline-flex items-center px-2 py-0.5`), those still pass too. Most likely no changes needed; verify by running the file.

### Task 2.7: `EventFeed` AI event badges

**Files:**
- Modify: `frontend/components/ai-panel/EventFeed.tsx`

- [ ] **Step 1: Drop the `badgeBase` constant and use `<Chip>` for every event badge**

Find (around line 19):

```ts
const badgeBase = 'inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide shrink-0'
```

Remove the constant entirely.

Find each card (`ToolCallCard`, `ResultCard`, `ThinkingCard`, `DoneCard`). Each has a `<span className={`${badgeBase} bg-{tone}/15 text-{tone}-deep`}>LABEL</span>` pattern. Replace each:

`ToolCallCard` (around line 35):

```tsx
        <span className={`${badgeBase} bg-accent-indigo/15 text-accent-indigo-deep`}>TOOL CALL</span>
```

becomes:

```tsx
        <Chip variant="status" tone="accent-indigo" className="shrink-0">Tool Call</Chip>
```

`ResultCard` (around line 49):

```tsx
        <span className={`${badgeBase} bg-success/15 text-success-deep`}>RESULT</span>
```

becomes:

```tsx
        <Chip variant="status" tone="success" className="shrink-0">Result</Chip>
```

`ThinkingCard` (around line 63):

```tsx
        <span className={`${badgeBase} bg-accent-purple/15 text-accent-purple-deep`}>THINKING</span>
```

becomes:

```tsx
        <Chip variant="status" tone="accent-purple" className="shrink-0">Thinking</Chip>
```

`DoneCard` (around line 75):

```tsx
        <span className={`${badgeBase} bg-fg-subtle/15 text-fg-muted`}>DONE</span>
```

becomes:

```tsx
        <Chip variant="status" tone="neutral" className="shrink-0">Done</Chip>
```

Add the import at the top of the file:

```tsx
import { Chip } from '@/components/ui/Chip'
```

If there's a `TOOL RESULT` label anywhere (the spec mentions it), title-case it to `Tool Result` too.

- [ ] **Step 2: Verify nothing else uses `badgeBase`**

```bash
grep -n "badgeBase" frontend/components/ai-panel/EventFeed.tsx
```

Expected: no output (the constant is deleted, no remaining references).

- [ ] **Step 3: Update `EventFeed.test.tsx` (if exists) for title-case labels**

Find any text assertions in `frontend/__tests__/ai-panel/EventFeed.test.ts` (or `.tsx`). Update:

- `getByText('TOOL CALL')` → `getByText('Tool Call')`
- `getByText('RESULT')` → `getByText('Result')`
- `getByText('THINKING')` → `getByText('Thinking')`
- `getByText('DONE')` → `getByText('Done')`

If no test file exists for EventFeed, skip this step.

### Task 2.8: `DimensionChip` thin wrapper

**Files:**
- Modify: `frontend/components/dq/DimensionChip.tsx`

- [ ] **Step 1: Inspect `lib/dq/dimensions.ts` to find the existing `dimensionTokens` API**

```bash
grep -n "dimensionTokens\|StatusTone\|DIMENSION_" frontend/lib/dq/dimensions.ts | head -20
```

Read the file to understand what `dimensionTokens(dimension)` returns today. It probably returns `{ label, fillClass, textClass }` (per the spec). We need it to also expose a `tone: StatusTone`.

- [ ] **Step 2: Extend `dimensionTokens` to return a `tone` field**

In `frontend/lib/dq/dimensions.ts`, find the return type and add a `tone: StatusTone` field. Map each dimension to the appropriate tone:

The exact mapping depends on what dimensions exist. Read the file and add the `tone` derivation. For example, if dimensions are `completeness / validity / uniqueness / consistency / accuracy / timeliness`, a sensible mapping is something like:

- `completeness` → `accent-purple` (matches the AI summary semantic)
- `validity` → `info`
- `uniqueness` → `success`
- `consistency` → `warning`
- `accuracy` → `danger`
- `timeliness` → `accent-indigo`

…but follow whatever the existing color palette implies. If `fillClass` says `bg-accent-purple/15`, map to `accent-purple`. Walk the file and translate each existing className output to its matching `StatusTone`.

Add the import:

```ts
import type { StatusTone } from '@/components/ui/Chip'
```

- [ ] **Step 3: Rewrite `DimensionChip.tsx` to use `<Chip>`**

Replace:

```tsx
import { dimensionTokens } from '@/lib/dq/dimensions'

interface Props {
  dimension: string
  className?: string
}

export function DimensionChip({ dimension, className = '' }: Props) {
  const t = dimensionTokens(dimension)
  return (
    <span
      data-dimension={t.label.toLowerCase()}
      className={[
        'inline-flex items-center px-2 py-1 rounded-md text-[12px] font-medium tracking-tight',
        t.fillClass,
        t.textClass,
        className,
      ].join(' ')}
    >
      {t.label}
    </span>
  )
}
```

With:

```tsx
import { Chip } from '@/components/ui/Chip'
import { dimensionTokens } from '@/lib/dq/dimensions'

interface Props {
  dimension: string
  className?: string
}

export function DimensionChip({ dimension, className = '' }: Props) {
  const t = dimensionTokens(dimension)
  return (
    <Chip variant="status" tone={t.tone} className={className}>
      {t.label}
    </Chip>
  )
}
```

The `data-dimension` attribute is dropped. Check if any test asserts on it:

```bash
grep -n "data-dimension" frontend/__tests__ 2>&1
```

If yes, wrap the children in a `<span data-dimension={t.label.toLowerCase()}>{t.label}</span>` inside the Chip. If no, leave dropped.

The `fillClass` and `textClass` fields can stay in the `dimensionTokens` return shape if other code uses them — only drop them if `DimensionChip` is the sole consumer. To check:

```bash
grep -rn "fillClass\|textClass" frontend --include="*.tsx" --include="*.ts" | grep -v ".next" | grep -v "node_modules"
```

If only DimensionChip uses them, drop those fields. Otherwise keep them.

### Task 2.9: Run the suite + commit Phase 2

- [ ] **Step 1: Full verification**

```bash
cd frontend && npx tsc --noEmit && npx jest && npm run build
```

Expected:
- `tsc`: clean.
- `jest`: ~200 passing / 1 failing (the documented `useAIStream` red is the only failure). +12 new Chip primitive tests offset by the existing assertions that were rewritten in place. If a test fails because of a leftover class assertion, fix it inline.
- `npm run build`: succeeds.

- [ ] **Step 2: Verify no chip-shaped code remains outside the primitive**

```bash
grep -rEn "inline-flex.*(px-2|px-2\.5)\s+py-0\.5\s+rounded-(md|full)" frontend/components frontend/app --include="*.tsx" 2>&1 | grep -v "ui/Chip.tsx" | grep -v "demo/chips" | grep -v ".next"
```

Expected: empty (no ad-hoc chip class strings remain in production code outside the primitive itself or the temporary showcase).

If any remain, walk each and decide:
- Is it a button (e.g., a CTA with the same px-4 py-2 shape)? Leave alone — buttons aren't chips.
- Is it an actual chip? Refactor to use `<Chip>`.

- [ ] **Step 3: Commit Phase 2**

```bash
git add frontend/components frontend/__tests__
git commit -m "$(cat <<'EOF'
refactor(chips): migrate every call site to Chip + title-case labels

Single mechanical refactor: every chip-shaped element across the
frontend now renders via <Chip>. Status chips drop the inline class
strings, the badgeBase const in EventFeed, the CHIP_CLASSES map in
SessionCard, and the className-output mode of _profile/chip-classes.ts
(now returns a StatusTone via the renamed chipTone(type) helper). The
Validate result chip drops its border (was border border-{tone}/30).

Title Case applied to every chip label:
- AI event badges: TOOL CALL → Tool Call, RESULT → Result, THINKING →
  Thinking, DONE → Done.
- Validate result chips: PASSED → Passed, FAILED · N → Failed · N,
  EVAL ERROR → Eval Error.
- DimensionChip, AlertRow, SessionCard chips already used Title Case.

Files touched:
- frontend/components/ui/Chip.tsx (existing; no change here)
- frontend/components/workspace/TopBar.tsx
- frontend/components/sessions/SessionCard.tsx
- frontend/components/sessions/UploadModal.tsx
- frontend/components/stages/ExplorationStage.tsx
- frontend/components/stages/ValidateStage.tsx
- frontend/components/stages/_profile/AlertRow.tsx
- frontend/components/stages/_profile/chip-classes.ts (chipClasses → chipTone)
- frontend/components/ai-panel/EventFeed.tsx (drops badgeBase)
- frontend/components/dq/DimensionChip.tsx (thin wrapper)
- frontend/lib/dq/dimensions.ts (added tone field to dimensionTokens)

Test assertions updated inline for class-string deltas + Title Case
labels. Full suite at 200-ish / 1 failing — pre-existing useAIStream
red unchanged.
EOF
)"
```

---

## Phase 3 — Drop the preview route + tag

### Task 3.1: Delete `/demo/chips`

**Files:**
- Delete: `frontend/app/demo/chips/page.tsx`

- [ ] **Step 1: Remove the preview file**

```bash
git rm frontend/app/demo/chips/page.tsx
```

- [ ] **Step 2: Confirm the route is gone from the build**

```bash
cd frontend && npm run build
```

Expected: succeeds. The build output should NOT list `/demo/chips` in the Route (app) section.

- [ ] **Step 3: Commit Phase 3**

```bash
git commit -m "$(cat <<'EOF'
chore(preview): remove /demo/chips showcase

The Chip primitive shipped and every call site migrated in the
previous commit. The temporary showcase is no longer the
source of design truth — drop it. Mirrors the same drop pattern
used for the per-stage previews in earlier mini-stages.
EOF
)"
```

### Task 3.2: Tag `chip-system-v1`

- [ ] **Step 1: Create the annotated tag**

```bash
git tag -a chip-system-v1 -m "$(cat <<'EOF'
Chip system consolidation

Single shared Chip primitive at frontend/components/ui/Chip.tsx
with three variants:
- status: semantic-colored soft fill, no border. Tones: success,
  warning, danger, info, accent-purple, accent-indigo, neutral.
  Used for stage statuses, alert types, validation results, AI
  event kinds, DQ dimensions.
- neutral: bg-elevated + border-border + text-fg-muted. Optional
  value sub-span for label+value pairs (validity 78%). Used for
  Round counter, file-type chips, category labels.
- score: outline-only rounded-full pill, kept intentionally distinct
  for the TopBar score readout.

Every chip-shaped consumer migrated:
- TopBar Score, SessionCard stage, AlertRow alert type,
  ExplorationStage Round, ValidateStage CategoryPill + result chip,
  UploadModal file-type chips, EventFeed AI event badges,
  DimensionChip.

Bundled fixes:
- WCAG AA contrast: success-deep and warning-deep darkened one
  Tailwind tier (700 → 800) so the bg-{tone}/15 + text-{tone}-deep
  palette clears 4.5:1 on every workspace surface (5.80–6.31, was
  4.08–4.47). Strict improvement everywhere these tokens are used.
- Title Case: every chip label converts to Title Case. AI event
  badges (Tool Call / Result / Thinking / Done), Validate result
  chips (Passed / Failed · N / Eval Error).

Chip primitive lives at frontend/components/ui/Chip.tsx with 12
contract tests. Full suite ~200/201 passing (the pre-existing
useAIStream red predates Round 1).
EOF
)" && git tag --list 'chip-system-v1'
```

- [ ] **Step 2: Confirm**

```bash
git show chip-system-v1 --no-patch --format="%H %s"
```

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Chip primitive with three variants and tones | Already exists at `frontend/components/ui/Chip.tsx` (committed `3168fbd`) + verified in Task 1.1 + tested in Task 1.2 |
| Status variant: no border, px-2 py-0.5, rounded-md, text-[11px] font-semibold | Task 1.2 (test assertions pin every class) |
| Neutral variant: bg-elevated + border + text-fg-muted with optional value | Task 1.2 (separate it.each for label-only and label+value) |
| Score variant: rounded-full + outline-only | Task 1.2 (3-tone parameterized test) |
| WCAG fix: success-deep + warning-deep darkened | Already landed in commit `d4c6213` (frontend/app/globals.css) |
| Title Case messaging on AI event badges | Task 2.7 |
| Title Case messaging on Validate result chips | Task 2.5 |
| Per-call-site migration (TopBar / SessionCard / AlertRow / ExplorationStage / ValidateStage / UploadModal / EventFeed / DimensionChip) | Tasks 2.1–2.8 each |
| `chip-classes.ts` returns tone instead of className | Task 2.3 |
| Drop `badgeBase` const in EventFeed | Task 2.7 Step 2 (grep verification) |
| Delete `/demo/chips` before tag | Task 3.1 |
| Tag `chip-system-v1` | Task 3.2 |

**Placeholder scan:** No TBDs, no "add error handling" stubs, no "similar to Task N" cross-references. Every step has executable code or an exact command + expected output.

**Type consistency:**
- `StatusTone` and `ScoreTone` are imported from `@/components/ui/Chip` in every consumer that needs them. Single source of truth.
- `chipTone` function name (renamed from `chipClasses`) is consistent across AlertRow.tsx, chip-classes.ts, chip-classes.test.ts.
- `dimensionTokens` return shape gains a `tone: StatusTone` field; existing `fillClass`/`textClass` may stay or go depending on other consumers (Task 2.8 Step 3 grep decides).

**Out-of-scope reminders for the implementer:**
- Do **not** change the Score chip's distinct shape (rounded-full + outline-only). Spec explicitly keeps it as an intentional exception.
- Do **not** add new tones beyond the 7 status + 3 score tones already in the primitive.
- Do **not** refactor buttons. The button vocabulary (primary navy + neutral secondary + compact secondary) is a separate concern that already shares structure.
- Do **not** touch Figma in this branch. The user is updating Figma separately.
- Do **not** further darken `text-accent-{purple,indigo}-deep` or fix the borderline-but-passing contrast — those tones cleanly pass AA.

**Commit count:** 3 commits + 1 tag, matches the spec's 5-commit cadence (with the token shift already counted as a prior commit via `d4c6213`).
