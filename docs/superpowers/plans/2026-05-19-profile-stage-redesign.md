# Profile Stage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Round 2 / Stage 4 — a retokenized `ProfileStage` with an accent-purple AI summary card, a per-alert list under the stats grid, the dropped column-breakdown table, and the established primary CTA shape — plus two small internal modules (`chipClasses` helper + `AlertRow` presentational) extracted so the page itself stays readable.

**Architecture:** Pure helper (`chipClasses`) → presentational component (`AlertRow`) → page rewrite (`ProfileStage`). Each layer has one job and is tested independently. The page reads `session.profile.alerts` as-is (existing payload, no backend changes) and delegates each alert to `AlertRow`.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4 (foundation tokens — `text-fg`, `bg-accent-purple/15`, `text-accent-purple-deep`, `bg-warning/15`, `text-warning-deep`, `bg-info/15`, `text-info-deep`, `bg-danger/15`, `text-danger-deep`, `bg-brand-accent`, `text-on-brand`, `border-brand-primary`), lucide-react, Jest 30 + ts-jest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-19-profile-stage-redesign.md`

**Figma reference:** `Profile / 1440x900 / Default` (`131:239`) on page `02 — Foundation` of `gsnW43uSpvdLpwandZM8Zx`.

---

## File Structure

```
frontend/
  components/
    stages/
      ProfileStage.tsx                       # MODIFY — full rewrite
      _profile/
        chip-classes.ts                      # NEW — chipClasses(type) helper
        AlertRow.tsx                         # NEW — presentational <AlertRow alert={...} />
  __tests__/
    stages/
      ProfileStage.test.tsx                  # NEW — page integration
      _profile/
        chip-classes.test.ts                 # NEW — pure-fn unit
        AlertRow.test.tsx                    # NEW — component unit
```

Path alias `@/` resolves to `frontend/`. The `_profile/` underscore prefix communicates "these are ProfileStage-internal — don't import them from outside `components/stages/`". They're public for testing via `@/components/stages/_profile/...`.

Commit cadence — three commits + a verification phase:

1. **chip-classes helper** (Phase 0)
2. **AlertRow component** (Phase 1)
3. **ProfileStage rewrite** (Phase 2)

Phase 3 is manual verification + optional tag (no commit unless tagging).

---

## Phase 0 — `chipClasses` helper

Pure string mapping. Three-bucket color system keyed off the alert `type` substring. Falls through to `danger` for unknown types so anything new still surfaces visibly.

### Task 0.1: Write the failing test

**Files:**
- Create: `frontend/__tests__/stages/_profile/chip-classes.test.ts`

- [ ] **Step 1: Create the directory and write the test**

```ts
// frontend/__tests__/stages/_profile/chip-classes.test.ts
import { chipClasses } from '@/components/stages/_profile/chip-classes'

describe('chipClasses', () => {
  describe('warning bucket (amber)', () => {
    it.each(['Missing', 'missing', 'MISSING', 'Constant', 'constant'])(
      'maps %s to warning',
      (input) => {
        const cls = chipClasses(input)
        expect(cls).toContain('bg-warning/15')
        expect(cls).toContain('text-warning-deep')
      },
    )
  })

  describe('info bucket (blue)', () => {
    it.each(['High Cardinality', 'high cardinality', 'Duplicates', 'Skewness', 'Skew'])(
      'maps %s to info',
      (input) => {
        const cls = chipClasses(input)
        expect(cls).toContain('bg-info/15')
        expect(cls).toContain('text-info-deep')
      },
    )
  })

  describe('danger bucket (red fallback)', () => {
    it.each(['Type Mismatch', 'Some Future Alert', 'unknown', ''])(
      'maps %s (unrecognized) to danger',
      (input) => {
        const cls = chipClasses(input)
        expect(cls).toContain('bg-danger/15')
        expect(cls).toContain('text-danger-deep')
      },
    )

    it('handles null and undefined safely', () => {
      expect(chipClasses(null)).toContain('text-danger-deep')
      expect(chipClasses(undefined)).toContain('text-danger-deep')
    })
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
cd frontend && npx jest __tests__/stages/_profile/chip-classes.test.ts
```

Expected: FAIL with "Cannot find module '@/components/stages/_profile/chip-classes'".

### Task 0.2: Implement `chip-classes.ts`

**Files:**
- Create: `frontend/components/stages/_profile/chip-classes.ts`

- [ ] **Step 1: Write the helper**

```ts
// frontend/components/stages/_profile/chip-classes.ts

/**
 * Map a ydata-profiling alert `type` string to the Tailwind class set that
 * styles the chip in the Profile stage's alert list. Three buckets:
 *
 *  - Missing / Constant            → warning (amber)
 *  - High Cardinality / Duplicates / Skewness → info (blue)
 *  - Anything else                 → danger (red, intentional fallback so new
 *                                   alert types still surface visibly)
 *
 * Case-insensitive and null/undefined safe so we don't have to enumerate every
 * upstream variant.
 */
export function chipClasses(type: string | null | undefined): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('missing') || t.includes('constant')) {
    return 'bg-warning/15 text-warning-deep'
  }
  if (t.includes('cardinality') || t.includes('duplicate') || t.includes('skew')) {
    return 'bg-info/15 text-info-deep'
  }
  return 'bg-danger/15 text-danger-deep'
}
```

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/stages/_profile/chip-classes.test.ts
```

Expected: all `it.each` rows pass plus the null/undefined check.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean for the new file. The pre-existing `.next/types/validator.ts` warning from earlier stages can be ignored — it's a stale Next.js artifact from a deleted preview route.

- [ ] **Step 4: Commit Phase 0**

```bash
git add frontend/components/stages/_profile/chip-classes.ts \
        frontend/__tests__/stages/_profile/chip-classes.test.ts
git commit -m "$(cat <<'EOF'
feat(profile): add chipClasses helper for alert-type tinting

Three-bucket color mapping keyed off substring of the upstream alert
type:
- Missing / Constant            → warning (amber)
- High Cardinality / Duplicates / Skewness → info (blue)
- everything else               → danger (red — intentional fallback
                                  so unknown types still surface)

Case-insensitive, null-safe. Consumed by AlertRow in the next phase.
EOF
)"
```

---

## Phase 1 — `AlertRow` component

Presentational. Reads `column`, `type`, `description` from its prop. Calls `chipClasses`. No state, no callbacks.

### Task 1.1: Write the failing test

**Files:**
- Create: `frontend/__tests__/stages/_profile/AlertRow.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/stages/_profile/AlertRow.test.tsx
import { render, screen } from '@testing-library/react'
import { AlertRow } from '@/components/stages/_profile/AlertRow'

describe('AlertRow', () => {
  it('renders column name, type chip, and description', () => {
    render(
      <AlertRow
        alert={{
          column: 'co_signer_ssn',
          type: 'Missing',
          description: '7,617 (41%) values missing — column may be optional.',
        }}
      />,
    )
    expect(screen.getByText('co_signer_ssn')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText(/7,617/)).toBeInTheDocument()
  })

  it('uses the warning bucket for Missing alerts', () => {
    render(<AlertRow alert={{ column: 'email', type: 'Missing', description: 'x' }} />)
    const chip = screen.getByText('Missing')
    expect(chip.className).toContain('text-warning-deep')
    expect(chip.className).toContain('bg-warning/15')
  })

  it('uses the info bucket for High Cardinality alerts', () => {
    render(<AlertRow alert={{ column: 'tenure', type: 'High Cardinality', description: 'x' }} />)
    expect(screen.getByText('High Cardinality').className).toContain('text-info-deep')
  })

  it('falls back to "Table-level" when the alert has no column', () => {
    render(<AlertRow alert={{ type: 'Duplicates', description: '42 duplicate rows' }} />)
    expect(screen.getByText('Table-level')).toBeInTheDocument()
  })

  it('hides the chip when the alert has no type', () => {
    render(<AlertRow alert={{ column: 'foo', description: 'something happened' }} />)
    expect(screen.getByText('foo')).toBeInTheDocument()
    // No chip should be rendered when type is absent.
    expect(screen.queryByText(/Missing|Constant|High Cardinality|Duplicates|Skewness/)).toBeNull()
  })

  it('hides the description paragraph when the alert has no description', () => {
    const { container } = render(<AlertRow alert={{ column: 'foo', type: 'Missing' }} />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('renders as a <li> so it can be a flex-column child of a <ul>', () => {
    const { container } = render(<AlertRow alert={{ column: 'x', type: 'Missing', description: 'y' }} />)
    expect(container.firstChild?.nodeName).toBe('LI')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/stages/_profile/AlertRow.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/stages/_profile/AlertRow'".

### Task 1.2: Implement `AlertRow.tsx`

**Files:**
- Create: `frontend/components/stages/_profile/AlertRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/stages/_profile/AlertRow.tsx
'use client'
import { chipClasses } from './chip-classes'

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

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/stages/_profile/AlertRow.test.tsx
```

Expected: 7/7 pass.

- [ ] **Step 3: Regression check on Phase 0**

```bash
cd frontend && npx jest __tests__/stages/_profile/chip-classes.test.ts
```

Expected: all green (unchanged from Phase 0).

- [ ] **Step 4: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean for the new file.

- [ ] **Step 5: Commit Phase 1**

```bash
git add frontend/components/stages/_profile/AlertRow.tsx \
        frontend/__tests__/stages/_profile/AlertRow.test.tsx
git commit -m "$(cat <<'EOF'
feat(profile): add AlertRow presentational component

Renders a single ydata-profiling alert as a tinted card row: column
name + colored type chip + description. Calls chipClasses() to pick
the chip palette. Falls back to 'Table-level' when the alert has no
column. Hides the chip/description independently when their fields
are absent.

Consumed by ProfileStage in the next phase.
EOF
)"
```

---

## Phase 2 — `ProfileStage` rewrite

Full replacement of the existing 95-line file. Drops the column breakdown, adds the alerts list, retokenizes every legacy class, swaps the indigo AI summary card for accent-purple, and swaps the indigo continue button for the established primary-button shape with a lucide `ArrowRight` icon.

### Task 2.1: Write the failing integration test

**Files:**
- Create: `frontend/__tests__/stages/ProfileStage.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/stages/ProfileStage.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ProfileStage } from '@/components/stages/ProfileStage'
import type { SessionState } from '@/lib/types'

function makeSession(overrides: Partial<SessionState> & { profile?: Record<string, unknown> } = {}): SessionState {
  return {
    session_id: 's1',
    stage: 'PROFILING',
    profile: {
      table: { n_rows: 18432, n_columns: 47, p_cells_missing: 0.07 },
      alerts: [],
    },
    ai_summary: '',
    suggested_rules: [],
    baseline_quality_score: 0,
    current_score: 0,
    validation_summary: '',
    anomaly_summary: '',
    transformation_log: [],
    scorecard: {},
    narrative: '',
    output_dir: '',
    zip_path: '',
    ...overrides,
  } as unknown as SessionState
}

describe('ProfileStage', () => {
  it('renders the loading AI summary card when ai_summary is empty', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.getByText(/AI is analyzing your dataset/)).toBeInTheDocument()
    const spinner = screen.getByRole('status', { name: /analyzing/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
  })

  it('renders the populated AI summary card when ai_summary is set', () => {
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'A loan-origination dataset (18,432 rows).' })}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByText(/loan-origination dataset/)).toBeInTheDocument()
    expect(screen.getByText('✦ AI SUMMARY')).toBeInTheDocument()
  })

  it('formats large row counts with thousands separators', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.getByText('18,432')).toBeInTheDocument()
  })

  it('shows "—" placeholders when table.n_rows / n_columns are missing', () => {
    render(
      <ProfileStage
        session={makeSession({ profile: { table: {}, alerts: [] } })}
        onContinue={() => {}}
      />,
    )
    // Both Rows and Columns tiles render —
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('colors completeness success-deep at 93%', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    const value = screen.getByText('93%')
    expect(value.className).toContain('text-success-deep')
  })

  it('colors completeness warning-deep below 90%', () => {
    render(
      <ProfileStage
        session={makeSession({
          profile: { table: { n_rows: 100, n_columns: 5, p_cells_missing: 0.25 }, alerts: [] },
        })}
        onContinue={() => {}}
      />,
    )
    const value = screen.getByText('75%')
    expect(value.className).toContain('text-warning-deep')
  })

  it('colors the Alerts tile warning-deep when alerts.length > 0', () => {
    render(
      <ProfileStage
        session={makeSession({
          profile: {
            table: { n_rows: 100, n_columns: 5, p_cells_missing: 0 },
            alerts: [{ column: 'email', type: 'Missing', description: 'x' }],
          },
        })}
        onContinue={() => {}}
      />,
    )
    const value = screen.getByText('1')
    expect(value.className).toContain('text-warning-deep')
  })

  it('hides the alerts list when alerts is empty', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.queryByText(/^Alerts \(/)).toBeNull()
  })

  it('renders one row per alert with column, type, and description', () => {
    render(
      <ProfileStage
        session={makeSession({
          profile: {
            table: { n_rows: 100, n_columns: 5, p_cells_missing: 0 },
            alerts: [
              { column: 'email', type: 'Missing', description: '6.7% missing' },
              { column: 'tenure', type: 'High Cardinality', description: '100% distinct' },
            ],
          },
        })}
        onContinue={() => {}}
      />,
    )
    expect(screen.getByText('Alerts (2)')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('tenure')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.getByText('High Cardinality')).toBeInTheDocument()
    expect(screen.getByText('6.7% missing')).toBeInTheDocument()
    expect(screen.getByText('100% distinct')).toBeInTheDocument()
  })

  it('hides the Continue button when ai_summary is empty (live)', () => {
    render(<ProfileStage session={makeSession()} onContinue={() => {}} />)
    expect(screen.queryByRole('button', { name: /continue to rules/i })).toBeNull()
  })

  it('hides the Continue button in readOnly mode even when ai_summary is set', () => {
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'done.' })}
        onContinue={() => {}}
        readOnly
      />,
    )
    expect(screen.queryByRole('button', { name: /continue to rules/i })).toBeNull()
  })

  it('renders the Continue button when ai_summary is set and not readOnly', () => {
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'done.' })}
        onContinue={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /continue to rules/i })
    expect(btn.className).toContain('bg-brand-accent')
    expect(btn.className).toContain('text-on-brand')
  })

  it('fires onContinue when the Continue button is clicked', () => {
    const onContinue = jest.fn()
    render(
      <ProfileStage
        session={makeSession({ ai_summary: 'done.' })}
        onContinue={onContinue}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /continue to rules/i }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/stages/ProfileStage.test.tsx
```

Expected: FAIL — the current `ProfileStage` uses legacy tokens (`text-text-primary`, `text-success-light`), renders the column breakdown, uses indigo classes for the AI summary, etc. Several assertions should fail on class names and missing elements (the alerts list label `Alerts (N)`, the `text-success-deep` class, etc.).

### Task 2.2: Rewrite `ProfileStage.tsx`

**Files:**
- Modify: `frontend/components/stages/ProfileStage.tsx` (full rewrite)

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/components/stages/ProfileStage.tsx
'use client'
import { ArrowRight } from 'lucide-react'
import type { SessionState } from '@/lib/types'
import { AlertRow, type AlertEntry } from './_profile/AlertRow'

interface Props {
  session: SessionState
  onContinue: () => void
  readOnly?: boolean
}

interface TableInfo {
  n_rows?: number
  n_columns?: number
  p_cells_missing?: number
}

export function ProfileStage({ session, onContinue, readOnly }: Props) {
  const profile = (session.profile ?? {}) as Record<string, unknown>
  const table = (profile.table ?? {}) as TableInfo
  const alerts: AlertEntry[] = (profile.alerts as AlertEntry[]) ?? []
  const completeness =
    table.p_cells_missing != null ? Math.round((1 - table.p_cells_missing) * 100) : null
  const isReady = !!session.ai_summary
  const showContinue = isReady && !readOnly

  return (
    <div className="p-5 flex flex-col gap-4">
      {/* Heading */}
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Data Profile</h1>
        <p className="text-xs text-fg-muted">
          AI analysis of your dataset structure and quality characteristics
        </p>
      </div>

      {/* AI Summary card — populated or loading */}
      {session.ai_summary ? (
        <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-xl p-4 flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-accent-purple-deep">
            ✦ AI SUMMARY
          </div>
          <p className="text-xs text-accent-purple-deep leading-relaxed">
            {session.ai_summary}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
          <div
            role="status"
            aria-label="Analyzing"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">AI is analyzing your dataset…</span>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Completeness */}
        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Completeness
          </div>
          <div
            className={`text-2xl font-bold ${
              completeness != null && completeness >= 90
                ? 'text-success-deep'
                : 'text-warning-deep'
            }`}
          >
            {completeness != null ? `${completeness}%` : '—'}
          </div>
          {completeness != null && (
            <div className="mt-2 bg-border rounded h-1 overflow-hidden">
              <div
                className={`h-full rounded ${
                  completeness >= 90 ? 'bg-success-deep' : 'bg-warning-deep'
                }`}
                style={{ width: `${completeness}%` }}
              />
            </div>
          )}
        </div>

        {/* Rows */}
        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Rows
          </div>
          <div className="text-2xl font-bold text-fg">
            {table.n_rows != null ? table.n_rows.toLocaleString() : '—'}
          </div>
        </div>

        {/* Columns */}
        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Columns
          </div>
          <div className="text-2xl font-bold text-fg">
            {table.n_columns != null ? table.n_columns : '—'}
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Alerts
          </div>
          <div
            className={`text-2xl font-bold ${
              alerts.length > 0 ? 'text-warning-deep' : 'text-fg'
            }`}
          >
            {alerts.length}
          </div>
        </div>
      </div>

      {/* Alerts list */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Alerts ({alerts.length})
          </div>
          <ul className="flex flex-col gap-4 m-0 p-0">
            {alerts.map((alert, i) => (
              <AlertRow key={i} alert={alert} />
            ))}
          </ul>
        </div>
      )}

      {/* Continue CTA */}
      {showContinue && (
        <div className="flex justify-end mt-2">
          <button
            type="button"
            onClick={onContinue}
            data-testid="profile-continue"
            className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
          >
            Continue to Rules
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify ProfileStage tests pass**

```bash
cd frontend && npx jest __tests__/stages/ProfileStage.test.tsx
```

Expected: 13/13 pass.

- [ ] **Step 3: Regression check on the lower phases**

```bash
cd frontend && npx jest __tests__/stages/_profile/
```

Expected: all green — chip-classes (12) + AlertRow (7) = 19 assertions still passing.

- [ ] **Step 4: Full suite + type-check + build**

```bash
cd frontend && npx tsc --noEmit && npx jest && npm run build
```

Expected:
- `tsc`: clean for new/modified files. The `.next/types/validator.ts` warning (stale Next.js artifact) persists from earlier stages and is regenerated by `npm run build` — ignore.
- `jest`: pre-existing `useAIStream` failure stays the only failure. Going-in baseline: 104 passing / 1 failing. After Stage 4: ~118–119 passing / 1 failing (added 12 chip-classes + 7 AlertRow + 13 ProfileStage = 32 new assertions — some `it.each` blocks expand into multiple test cases).
- `npm run build`: succeeds.

- [ ] **Step 5: Commit Phase 2**

```bash
git add frontend/components/stages/ProfileStage.tsx \
        frontend/__tests__/stages/ProfileStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(profile): rewrite ProfileStage to token-driven chrome

Replaces the pre-foundation-v1 implementation:
- Heading + subhead retokenized (text-fg / text-fg-muted).
- AI summary card retokenized from indigo to accent-purple to match
  the THINKING semantic in the AI panel. Loading state uses the
  brand-primary spinner ring (same as LoadingStage).
- Stats grid: section labels match the established
  text-xs / font-semibold / uppercase / tracking-wider pattern.
  Color tokens swap from text-{success,warning,danger}-light to
  -deep variants. Completeness progress bar fill no longer uses
  inline hex; uses bg-success-deep / bg-warning-deep.
- New alerts list (NEW): renders one AlertRow per profile.alerts
  entry under the stats grid. Hidden when alerts is empty.
- Drops the column breakdown table entirely. Its purpose was
  duplicated by the AI summary + alerts list; can be revisited
  later if a customer asks.
- Continue CTA picks up the established primary-button shape
  (bg-brand-accent + text-on-brand + hover:shadow-md +
  transition-all) and uses the lucide ArrowRight icon instead of
  the literal "→".

Behavior preserved: same Props (session, onContinue, readOnly),
same Continue gate (ai_summary && !readOnly), same data extraction
from session.profile.
EOF
)"
```

---

## Phase 3 — Verification

No code changes. Walk through the design in a running dev server, then optionally tag.

### Task 3.1: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Walk through the scenarios**

1. **Live PROFILING.** Open a session that's currently in `PROFILING` (or upload a fresh CSV and open it immediately). The Profile screen should show:
   - Loading AI summary card (orange spinner ring, "AI is analyzing your dataset…").
   - Stats grid populated as data arrives — Completeness with progress bar, Rows + Columns formatted, Alerts tile colored amber if > 0.
   - No Continue button yet (ai_summary still empty).

2. **Profile complete with summary.** Once the agent finishes and `ai_summary` populates:
   - Loading card swaps for the purple AI Summary card with the actual paragraph.
   - Continue button appears bottom-right in the navy primary-button style with the right-arrow icon.

3. **With alerts.** Sessions with `profile.alerts` populated show the Alerts (N) section under the stats grid. Verify chip colors:
   - `Missing` / `Constant` → amber chip (warning).
   - `High Cardinality` / `Duplicates` / `Skewness` → blue chip (info).
   - Anything else → red chip (danger fallback).

4. **No alerts.** A clean dataset (e.g. a small toy CSV) shows zero alerts — the Alerts (N) section is hidden entirely; the Continue button is the next thing under the stats grid.

5. **Snapshot view.** Open a `COMPLETE` session, then click `Profile` in the left stepper to view the historic snapshot. The Continue button is hidden (`readOnly` mode); everything else renders the same.

6. **Brand swap.** Append `?client=clayton` to a workspace URL and reload — the loading spinner ring, Continue button background, and any other brand-accent surfaces render in Clayton navy.

7. **Long AI summary.** Confirm the purple card grows vertically to fit a long paragraph (no truncation, no overflow).

8. **Many alerts.** With ≥ 10 alerts, the page scrolls naturally — the alerts list flows down and the Continue button sits at the bottom. No internal scroll container.

- [ ] **Step 3: (optional) Tag `profile-stage-v1` when verified**

```bash
git tag -a profile-stage-v1 -m "$(cat <<'EOF'
Round 2 Stage 4 — Profile stage redesign

Retokenized ProfileStage with accent-purple AI summary card,
per-alert list under the stats grid (3-bucket chip color system),
and the established primary-button Continue CTA. Drops the
column-breakdown table — its purpose is duplicated by the AI
summary + alerts list.

Two new internal modules:
- chipClasses(type) — pure helper mapping alert type to chip palette.
- <AlertRow alert={...}> — single-alert presentational card.
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Heading + subhead retokenize | Task 2.2 (`ProfileStage.tsx`) |
| AI summary populated (accent-purple) | Task 2.2 — `bg-accent-purple/15` block |
| AI summary loading (brand-primary spinner) | Task 2.2 — loading branch + Task 2.1 role=status assertion |
| Section label typography pattern | Task 2.2 — `text-xs font-semibold uppercase tracking-wider text-fg-muted` |
| Stats grid (4 tiles) | Task 2.2 — grid block + Task 2.1 assertions for color/value formatting |
| Completeness color logic | Task 2.2 — ternary on `completeness >= 90` + Task 2.1 90% / 75% test cases |
| Alerts tile color logic | Task 2.2 — ternary on `alerts.length > 0` + Task 2.1 assertion |
| Alerts list (NEW) | Task 2.2 — `{alerts.length > 0 && ...}` block + Task 2.1 multi-alert test |
| AlertRow shape | Task 1.2 |
| `Table-level` fallback | Task 1.2 + Task 1.1 assertion |
| chipClasses 3-bucket logic | Task 0.2 |
| chipClasses case-insensitivity + null safety | Task 0.1 `it.each` + null/undefined cases |
| Column breakdown removed | Task 2.2 — no breakdown block in new file |
| Continue CTA shape | Task 2.2 + Task 2.1 (`bg-brand-accent` / `text-on-brand` assertions) |
| Continue CTA gate (ai_summary && !readOnly) | Task 2.2 — `showContinue` const + Task 2.1 (3 test cases covering both gates) |
| Lucide `ArrowRight` icon on Continue | Task 2.2 — `import { ArrowRight }` |

**Placeholder scan:** every step has executable code or an exact command + expected output. No TBDs, no "similar to Task N", no references to undefined symbols.

**Type consistency:**
- `AlertEntry` interface (`{ column?, type?, description? }`) is defined in `AlertRow.tsx` (Task 1.2) and imported by `ProfileStage.tsx` (Task 2.2) via `import { AlertRow, type AlertEntry } from './_profile/AlertRow'`. Single source of truth.
- `chipClasses(type: string | null | undefined): string` signature matches its consumer (`AlertRow` always passes `type` which is `string | undefined`).
- `Props` for `ProfileStage` is unchanged from the existing file (`{ session, onContinue, readOnly }`) so existing call sites in `app/sessions/[id]/page.tsx` and `SnapshotStageView` need no changes.

**Commit count:** three commits — matches Stage 1–3 cadence. Each commit is independently testable and revertible.

**Pre-existing test failure caveat:** `__tests__/hooks/useAIStream.test.ts` has been failing since before Round 1; the spec/plan treat that as the unchanged baseline. Phase 2's "Step 4" verification calls this out explicitly so the implementer doesn't mistake it for a regression.
