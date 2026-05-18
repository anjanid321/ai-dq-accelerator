# Sessions List Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the home page (`frontend/app/page.tsx`) and `SessionCard` component to match the approved Figma sessions-list shells — simplified TopBar, IN-PROGRESS / COMPLETE section split, per-stage detail lines, soft-tinted dimension-chip-style stage chips, centered empty state.

**Architecture:** Three new components in `frontend/components/sessions/` (`SessionsTopBar`, `EmptyState`) + one new utility module (`frontend/lib/stages.ts`) extracting `STAGE_LABELS`, `stageCategory()`, `stageDetail()` so the page and the card share one source of truth. The card itself becomes a small presentational component reading from the new utility; the page handles layout + the section split.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4 (with the token system from foundation-v1), lucide-react, Jest 30 + ts-jest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-18-sessions-list-redesign.md` plus three Figma iterations that landed during review:
1. Stage chips use the **dimension-chip pattern** (`bg-X/15` soft tinted fill + `text-X-deep`, no border, `rounded-md` `px-2 py-1`) — not the score-chip pattern in the original spec.
2. Sessions list is **split into `IN PROGRESS` and `COMPLETE` sections** with their own grids.
3. Cards show a **per-stage detail line** under the date (`14 rules awaiting decision`, `Running 18 validations…`, `+18% over baseline`, etc.).

---

## File Structure

```
frontend/
  app/
    page.tsx                                   # MODIFY — full rewrite
  components/
    sessions/
      SessionCard.tsx                          # MODIFY — full rewrite
      EmptyState.tsx                           # NEW
      SessionsTopBar.tsx                       # NEW
      UploadModal.tsx                          # UNCHANGED
  lib/
    stages.ts                                  # NEW — STAGE_LABELS, stageCategory, stageDetail
  __tests__/
    lib/
      stages.test.ts                           # NEW
    components/
      sessions/
        SessionCard.test.tsx                   # NEW
        EmptyState.test.tsx                    # NEW
```

Path alias `@/` resolves to `frontend/` (existing).

Commit cadence: one commit per logical group:
1. **stages utility** (Phase 0)
2. **building blocks** (EmptyState + SessionsTopBar from Phase 1 + 2)
3. **SessionCard** (Phase 3)
4. **Home page rewrite** (Phase 4)
5. **Final cleanup** (Phase 5, if needed)

---

## Phase 0 — Stages utility module

Extracts the stage label mapping that already exists in `SessionCard.tsx` (lines 6–24) into a shared module, plus adds two new helpers: `stageCategory()` (groups stages into `awaiting | progress | complete`) and `stageDetail()` (returns a stage-specific detail line for the card).

### Task 0.1: Write the failing test for `stages.ts`

**Files:**
- Create: `frontend/__tests__/lib/stages.test.ts`

- [ ] **Step 1: Write the test**

```ts
// frontend/__tests__/lib/stages.test.ts
import {
  STAGE_LABELS,
  stageCategory,
  stageDetail,
  type SessionLike,
} from '@/lib/stages'
import type { WorkflowStage } from '@/lib/types'

describe('STAGE_LABELS', () => {
  it('has a non-empty label for every known stage', () => {
    const stages: WorkflowStage[] = [
      'LOADING','PROFILING',
      'AWAITING_INVESTIGATION_REVIEW','REINVESTIGATING','PROFILING_SYNTHESIS',
      'RULE_REVIEW','AWAITING_RULE_APPROVAL',
      'VALIDATING','TRIAGING','AWAITING_TRIAGE_APPROVAL',
      'PLANNING','AWAITING_PLAN_APPROVAL',
      'TRANSFORMATION_LOOP','AWAITING_HUMAN_INPUT',
      'AWAITING_PIPELINE_CONFIRMATION','GENERATING','COMPLETE',
    ]
    for (const s of stages) {
      expect(STAGE_LABELS[s].length).toBeGreaterThan(0)
    }
  })
})

describe('stageCategory', () => {
  it('routes AWAITING_* and RULE_REVIEW / PROFILING_SYNTHESIS to awaiting', () => {
    expect(stageCategory('AWAITING_RULE_APPROVAL')).toBe('awaiting')
    expect(stageCategory('AWAITING_INVESTIGATION_REVIEW')).toBe('awaiting')
    expect(stageCategory('AWAITING_TRIAGE_APPROVAL')).toBe('awaiting')
    expect(stageCategory('AWAITING_PLAN_APPROVAL')).toBe('awaiting')
    expect(stageCategory('AWAITING_HUMAN_INPUT')).toBe('awaiting')
    expect(stageCategory('AWAITING_PIPELINE_CONFIRMATION')).toBe('awaiting')
    expect(stageCategory('RULE_REVIEW')).toBe('awaiting')
    expect(stageCategory('PROFILING_SYNTHESIS')).toBe('awaiting')
  })

  it('routes AI-running stages to progress', () => {
    expect(stageCategory('LOADING')).toBe('progress')
    expect(stageCategory('PROFILING')).toBe('progress')
    expect(stageCategory('REINVESTIGATING')).toBe('progress')
    expect(stageCategory('VALIDATING')).toBe('progress')
    expect(stageCategory('TRIAGING')).toBe('progress')
    expect(stageCategory('PLANNING')).toBe('progress')
    expect(stageCategory('TRANSFORMATION_LOOP')).toBe('progress')
    expect(stageCategory('GENERATING')).toBe('progress')
  })

  it('routes COMPLETE to complete', () => {
    expect(stageCategory('COMPLETE')).toBe('complete')
  })

  it('falls back to progress for an unknown stage value', () => {
    expect(stageCategory('UNKNOWN_FUTURE_STAGE' as WorkflowStage)).toBe('progress')
  })
})

describe('stageDetail', () => {
  function s(stage: WorkflowStage, extra: Partial<SessionLike> = {}): SessionLike {
    return { stage, ...extra }
  }

  it('returns a count for AWAITING_RULE_APPROVAL when rule_count is provided', () => {
    expect(stageDetail(s('AWAITING_RULE_APPROVAL', { rule_count: 14 })))
      .toBe('14 rules awaiting decision')
  })

  it('returns the singular form for AWAITING_RULE_APPROVAL with one rule', () => {
    expect(stageDetail(s('AWAITING_RULE_APPROVAL', { rule_count: 1 })))
      .toBe('1 rule awaiting decision')
  })

  it('falls back to a generic awaiting message when rule_count is missing', () => {
    expect(stageDetail(s('AWAITING_RULE_APPROVAL'))).toBe('Awaiting rule decisions')
  })

  it('returns a baseline delta string for COMPLETE when both scores are present', () => {
    expect(stageDetail(s('COMPLETE', { baseline_score: 0.74, current_score: 0.92 })))
      .toBe('+18% over baseline')
  })

  it('returns null for COMPLETE when scores are missing (caller hides the detail line)', () => {
    expect(stageDetail(s('COMPLETE'))).toBeNull()
  })

  it('returns "Running validations…" for VALIDATING', () => {
    expect(stageDetail(s('VALIDATING'))).toBe('Running validations…')
  })

  it('returns "Plan ready for review" for AWAITING_PLAN_APPROVAL', () => {
    expect(stageDetail(s('AWAITING_PLAN_APPROVAL'))).toBe('Plan ready for review')
  })

  it('returns null for stages without a defined detail line (caller hides the line)', () => {
    expect(stageDetail(s('LOADING'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
cd frontend && npx jest __tests__/lib/stages.test.ts
```
Expected: FAIL with "Cannot find module '@/lib/stages'".

### Task 0.2: Implement `stages.ts`

**Files:**
- Create: `frontend/lib/stages.ts`

- [ ] **Step 1: Write the module**

```ts
// frontend/lib/stages.ts
import type { WorkflowStage } from './types'

/**
 * Human-readable label for every backend stage. Used by the session card chip,
 * the workspace breadcrumb, and anywhere else a stage value reaches the UI.
 */
export const STAGE_LABELS: Record<WorkflowStage, string> = {
  LOADING: 'Loading',
  PROFILING: 'Profiling',
  AWAITING_INVESTIGATION_REVIEW: 'Reviewing Exploration',
  REINVESTIGATING: 'Investigating',
  PROFILING_SYNTHESIS: 'Synthesizing',
  RULE_REVIEW: 'Reviewing Rules',
  AWAITING_RULE_APPROVAL: 'Awaiting Rules',
  VALIDATING: 'Validating',
  TRIAGING: 'Triaging',
  AWAITING_TRIAGE_APPROVAL: 'Awaiting Triage',
  PLANNING: 'Planning',
  AWAITING_PLAN_APPROVAL: 'Awaiting Plan',
  TRANSFORMATION_LOOP: 'Transforming',
  AWAITING_HUMAN_INPUT: 'Awaiting Input',
  AWAITING_PIPELINE_CONFIRMATION: 'Ready for Pipeline',
  GENERATING: 'Generating',
  COMPLETE: 'Complete',
}

/**
 * Visual category for the session-card chip palette:
 * - awaiting  → warning (amber)
 * - progress  → info (blue)
 * - complete  → success (green)
 */
export type StageCategory = 'awaiting' | 'progress' | 'complete'

const AWAITING: WorkflowStage[] = [
  'AWAITING_INVESTIGATION_REVIEW',
  'AWAITING_RULE_APPROVAL',
  'RULE_REVIEW',
  'AWAITING_TRIAGE_APPROVAL',
  'AWAITING_PLAN_APPROVAL',
  'AWAITING_HUMAN_INPUT',
  'AWAITING_PIPELINE_CONFIRMATION',
  'PROFILING_SYNTHESIS',
]

export function stageCategory(stage: WorkflowStage): StageCategory {
  if (stage === 'COMPLETE') return 'complete'
  if (AWAITING.includes(stage)) return 'awaiting'
  return 'progress'
}

/**
 * Stage-specific subtitle shown under the date on a SessionCard. Returns null
 * when there's nothing useful to show — the caller hides the detail line.
 *
 * Reads from a SessionLike shape so the helper stays decoupled from the full
 * SessionListEntry/SessionState interfaces (and tolerates partial mock data).
 */
export interface SessionLike {
  stage: WorkflowStage
  rule_count?: number
  finding_count?: number
  baseline_score?: number
  current_score?: number
}

export function stageDetail(s: SessionLike): string | null {
  switch (s.stage) {
    case 'AWAITING_RULE_APPROVAL': {
      if (typeof s.rule_count === 'number') {
        const noun = s.rule_count === 1 ? 'rule' : 'rules'
        return `${s.rule_count} ${noun} awaiting decision`
      }
      return 'Awaiting rule decisions'
    }
    case 'RULE_REVIEW':
      return 'Reviewing rules for contradictions…'
    case 'AWAITING_TRIAGE_APPROVAL': {
      if (typeof s.finding_count === 'number') {
        const noun = s.finding_count === 1 ? 'finding' : 'findings'
        return `${s.finding_count} ${noun} to triage`
      }
      return 'Awaiting triage decisions'
    }
    case 'AWAITING_PLAN_APPROVAL':
      return 'Plan ready for review'
    case 'AWAITING_INVESTIGATION_REVIEW':
      return 'Exploration ready for review'
    case 'AWAITING_HUMAN_INPUT':
      return 'Awaiting your input'
    case 'AWAITING_PIPELINE_CONFIRMATION':
      return 'Ready to generate pipeline'
    case 'PROFILING_SYNTHESIS':
      return 'Synthesizing findings…'
    case 'VALIDATING':
      return 'Running validations…'
    case 'TRIAGING':
      return 'Triaging findings…'
    case 'PLANNING':
      return 'Planning transformations…'
    case 'TRANSFORMATION_LOOP':
      return 'Executing transformations…'
    case 'GENERATING':
      return 'Generating pipeline…'
    case 'REINVESTIGATING':
      return 'Re-investigating…'
    case 'PROFILING':
      return 'Profiling columns…'
    case 'COMPLETE': {
      if (typeof s.baseline_score === 'number' && typeof s.current_score === 'number') {
        const delta = Math.round((s.current_score - s.baseline_score) * 100)
        const sign = delta >= 0 ? '+' : ''
        return `${sign}${delta}% over baseline`
      }
      return null
    }
    default:
      return null
  }
}
```

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/lib/stages.test.ts
```
Expected: 16 assertions across 8 tests, all passing.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit Phase 0**

```bash
git add frontend/lib/stages.ts frontend/__tests__/lib/stages.test.ts
git commit -m "feat(stages): extract stage labels + add category/detail helpers

Centralizes the human-readable stage labels (previously inline in
SessionCard) and adds two new helpers driving the redesigned session
card chrome:
- stageCategory(stage) → 'awaiting' | 'progress' | 'complete' for the
  chip color palette.
- stageDetail(session) → optional subtitle line ('14 rules awaiting
  decision', '+18% over baseline', etc.). Returns null when there's
  nothing useful to surface so the card can hide the row entirely."
```

---

## Phase 1 — `SessionsTopBar` component

A simplified top bar — Logo + app title + primary "New session" CTA. Distinct from the workspace `TopBar` because it has no filename / breadcrumb / score / overflow.

### Task 1.1: Build `SessionsTopBar`

**Files:**
- Create: `frontend/components/sessions/SessionsTopBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/sessions/SessionsTopBar.tsx
'use client'
import { Upload } from 'lucide-react'
import { Logo } from '@/components/theme/Logo'

interface Props {
  onNewSession: () => void
}

export function SessionsTopBar({ onNewSession }: Props) {
  return (
    <div className="h-14 bg-surface border-b border-border flex items-center gap-3 px-4 shrink-0">
      <Logo />
      <span className="text-sm font-semibold text-fg">DQ Accelerator</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onNewSession}
        data-testid="new-session"
        className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:brightness-110"
      >
        <Upload size={14} strokeWidth={2} />
        New session
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Do NOT commit yet** — bundled with EmptyState in the Phase 2 commit.

---

## Phase 2 — `EmptyState` component

The centered empty-state card.

### Task 2.1: Write the failing test

**Files:**
- Create: `frontend/__tests__/components/sessions/EmptyState.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/components/sessions/EmptyState.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '@/components/sessions/EmptyState'

describe('EmptyState', () => {
  it('renders the headline and body copy', () => {
    render(<EmptyState onUpload={() => {}} />)
    expect(screen.getByText('Start your first data quality session')).toBeInTheDocument()
    expect(screen.getByText(/Upload a CSV, Parquet, or JSON file/)).toBeInTheDocument()
  })

  it('fires onUpload when the CTA is clicked', () => {
    const onUpload = jest.fn()
    render(<EmptyState onUpload={onUpload} />)
    fireEvent.click(screen.getByTestId('empty-state-upload'))
    expect(onUpload).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/components/sessions/EmptyState.test.tsx
```
Expected: FAIL with "Cannot find module '@/components/sessions/EmptyState'".

### Task 2.2: Implement `EmptyState`

**Files:**
- Create: `frontend/components/sessions/EmptyState.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/components/sessions/EmptyState.tsx
'use client'
import { Upload, UploadCloud } from 'lucide-react'

interface Props {
  onUpload: () => void
}

export function EmptyState({ onUpload }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center bg-canvas">
      <div className="max-w-md w-full bg-surface border border-border rounded-lg p-8 flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center text-fg-muted">
          <UploadCloud size={28} strokeWidth={2} />
        </div>
        <h2 className="text-base font-semibold text-fg text-center">
          Start your first data quality session
        </h2>
        <p className="text-sm text-fg-muted leading-relaxed text-center">
          Upload a CSV, Parquet, or JSON file. AI will profile it, suggest rules, and walk you through cleanup.
        </p>
        <button
          type="button"
          onClick={onUpload}
          data-testid="empty-state-upload"
          className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:brightness-110"
        >
          <Upload size={14} strokeWidth={2} />
          Upload a dataset
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/components/sessions/EmptyState.test.tsx
```
Expected: 2/2 pass.

- [ ] **Step 3: Commit Phase 1 + 2 together**

```bash
git add frontend/components/sessions/SessionsTopBar.tsx \
        frontend/components/sessions/EmptyState.tsx \
        frontend/__tests__/components/sessions/EmptyState.test.tsx
git commit -m "feat(sessions): add SessionsTopBar and EmptyState building blocks

SessionsTopBar: simplified workspace TopBar variant (Logo + title +
primary 'New session' CTA, no breadcrumb/score). Distinct from the
workspace TopBar — homepage-only.

EmptyState: centered card with cloud-upload icon, headline, body copy,
and primary CTA. Replaces the single 'No sessions yet' line that lives
in the current home page."
```

---

## Phase 3 — `SessionCard` rewrite

Replaces the existing 105-line `SessionCard.tsx` with a retokenized version using soft tinted dimension-chip-style stage chips, the per-stage detail line, and the new neutral Download pill.

### Task 3.1: Write the failing test

**Files:**
- Create: `frontend/__tests__/components/sessions/SessionCard.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/components/sessions/SessionCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionCard } from '@/components/sessions/SessionCard'
import type { SessionListEntry } from '@/lib/types'

function makeEntry(overrides: Partial<SessionListEntry> = {}): SessionListEntry {
  return {
    id: 's1',
    filename: 'loans.csv',
    stage: 'AWAITING_RULE_APPROVAL',
    created_at: '2026-04-28T12:00:00Z',
    current_score: 0.72,
    baseline_score: 0.5,
    ...overrides,
  } as SessionListEntry
}

jest.mock('@/lib/api', () => ({
  deleteSession: jest.fn().mockResolvedValue(undefined),
  getPipelineDownloadUrl: (id: string) => `/api/sessions/${id}/pipeline`,
}))

describe('SessionCard', () => {
  it('renders filename, date, stage label, and score', () => {
    render(<SessionCard entry={makeEntry()} onOpen={() => {}} onDeleted={() => {}} />)
    expect(screen.getByText('loans.csv')).toBeInTheDocument()
    expect(screen.getByText(/Apr/)).toBeInTheDocument()
    expect(screen.getByText('Awaiting Rules')).toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('exposes data-stage-category on the chip', () => {
    render(<SessionCard entry={makeEntry()} onOpen={() => {}} onDeleted={() => {}} />)
    expect(screen.getByText('Awaiting Rules').closest('[data-stage-category]'))
      .toHaveAttribute('data-stage-category', 'awaiting')
  })

  it('exposes data-score-variant on the score block', () => {
    const { rerender } = render(
      <SessionCard entry={makeEntry({ current_score: 0.95 })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.getByTestId('score-block')).toHaveAttribute('data-score-variant', 'success')

    rerender(
      <SessionCard entry={makeEntry({ current_score: 0.75 })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.getByTestId('score-block')).toHaveAttribute('data-score-variant', 'warning')

    rerender(
      <SessionCard entry={makeEntry({ current_score: 0.55 })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.getByTestId('score-block')).toHaveAttribute('data-score-variant', 'danger')
  })

  it('shows the per-stage detail line when stageDetail returns a string', () => {
    render(
      <SessionCard
        entry={makeEntry({ stage: 'AWAITING_RULE_APPROVAL', rule_count: 14 })}
        onOpen={() => {}}
        onDeleted={() => {}}
      />,
    )
    expect(screen.getByText('14 rules awaiting decision')).toBeInTheDocument()
  })

  it('hides the detail line when stageDetail returns null', () => {
    render(
      <SessionCard
        entry={makeEntry({ stage: 'LOADING', current_score: 0, baseline_score: 0 })}
        onOpen={() => {}}
        onDeleted={() => {}}
      />,
    )
    expect(screen.queryByTestId('stage-detail')).toBeNull()
  })

  it('renders the Download button only when the stage is COMPLETE', () => {
    const { rerender } = render(
      <SessionCard entry={makeEntry({ stage: 'AWAITING_RULE_APPROVAL' })} onOpen={() => {}} onDeleted={() => {}} />,
    )
    expect(screen.queryByText('Download')).toBeNull()

    rerender(
      <SessionCard
        entry={makeEntry({ stage: 'COMPLETE', current_score: 0.92, baseline_score: 0.74 })}
        onOpen={() => {}}
        onDeleted={() => {}}
      />,
    )
    expect(screen.getByText('Download')).toBeInTheDocument()
  })

  it('clicking the card fires onOpen', () => {
    const onOpen = jest.fn()
    render(<SessionCard entry={makeEntry()} onOpen={onOpen} onDeleted={() => {}} />)
    fireEvent.click(screen.getByTestId('session-card'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('clicking delete twice deletes the session', async () => {
    const onDeleted = jest.fn()
    render(<SessionCard entry={makeEntry()} onOpen={() => {}} onDeleted={onDeleted} />)
    const btn = screen.getByTestId('session-delete')
    fireEvent.click(btn)
    expect(btn).toHaveTextContent(/confirm/i)
    fireEvent.click(btn)
    // deleteSession is mocked to resolve immediately; onDeleted should fire.
    await Promise.resolve()
    await Promise.resolve()
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/components/sessions/SessionCard.test.tsx
```
Expected: FAIL — existing card doesn't match these assertions (uses old class names, no data attributes, different markup).

### Task 3.2: Rewrite `SessionCard.tsx`

**Files:**
- Modify: `frontend/components/sessions/SessionCard.tsx` (full rewrite)

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/components/sessions/SessionCard.tsx
'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
import type { SessionListEntry } from '@/lib/types'
import { deleteSession, getPipelineDownloadUrl } from '@/lib/api'
import { STAGE_LABELS, stageCategory, stageDetail, type StageCategory } from '@/lib/stages'

interface Props {
  entry: SessionListEntry
  onOpen: () => void
  onDeleted: () => void
}

type ScoreVariant = 'success' | 'warning' | 'danger'
function scoreVariant(score: number): ScoreVariant {
  if (score >= 0.9) return 'success'
  if (score >= 0.7) return 'warning'
  return 'danger'
}

const CHIP_CLASSES: Record<StageCategory, string> = {
  awaiting: 'bg-warning/15 text-warning-deep',
  progress: 'bg-info/15 text-info-deep',
  complete: 'bg-success/15 text-success-deep',
}

const SCORE_TEXT: Record<ScoreVariant, string> = {
  success: 'text-success-deep',
  warning: 'text-warning-deep',
  danger:  'text-danger-deep',
}
const SCORE_TRACK: Record<ScoreVariant, string> = {
  success: 'bg-success/20',
  warning: 'bg-warning/20',
  danger:  'bg-danger/20',
}
const SCORE_FILL: Record<ScoreVariant, string> = {
  success: 'bg-success-deep',
  warning: 'bg-warning-deep',
  danger:  'bg-danger-deep',
}

export function SessionCard({ entry, onOpen, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const category = stageCategory(entry.stage)
  const score = entry.current_score ?? 0
  const variant = scoreVariant(score)
  const isComplete = entry.stage === 'COMPLETE'
  const detail = stageDetail(entry)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await deleteSession(entry.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      data-testid="session-card"
      className="group relative bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-fg-muted transition-colors flex flex-col gap-3"
      onClick={onOpen}
      onMouseLeave={() => setConfirming(false)}
    >
      <button
        type="button"
        data-testid="session-delete"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-fg-muted hover:text-danger-deep text-xs px-2 py-1 rounded-md"
        onClick={handleDelete}
        title={confirming ? 'Click again to confirm' : 'Delete session'}
      >
        {deleting ? '…' : confirming ? 'Confirm?' : '×'}
      </button>

      <div className="flex items-start gap-2 pr-6">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="text-sm font-semibold text-fg truncate">{entry.filename}</div>
          <div className="text-xs text-fg-muted">{new Date(entry.created_at).toLocaleDateString()}</div>
          {detail && (
            <div data-testid="stage-detail" className="text-[11px] font-medium text-fg-subtle">
              {detail}
            </div>
          )}
        </div>
        <span
          data-stage-category={category}
          className={[
            'inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold tracking-tight shrink-0',
            CHIP_CLASSES[category],
          ].join(' ')}
        >
          {STAGE_LABELS[entry.stage]}
        </span>
      </div>

      {score > 0 && (
        <div data-testid="score-block" data-score-variant={variant} className="flex flex-col gap-1.5">
          <div className="flex items-baseline">
            <span className="text-xs text-fg-muted">Quality Score</span>
            <span className="flex-1" />
            <span className={`text-xs font-semibold ${SCORE_TEXT[variant]}`}>{Math.round(score * 100)}%</span>
          </div>
          <div className={`h-1.5 rounded-full overflow-hidden ${SCORE_TRACK[variant]}`}>
            <div
              className={`h-full rounded-full ${SCORE_FILL[variant]}`}
              style={{ width: `${score * 100}%` }}
            />
          </div>
        </div>
      )}

      {isComplete && (
        <a
          href={getPipelineDownloadUrl(entry.id)}
          download
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center gap-1.5 w-full bg-surface border border-border-strong text-fg-muted text-[11px] font-medium px-2 py-1.5 rounded-md hover:bg-elevated"
        >
          <Download size={14} strokeWidth={2} />
          Download
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/components/sessions/SessionCard.test.tsx
```
Expected: 8/8 pass.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit Phase 3**

```bash
git add frontend/components/sessions/SessionCard.tsx \
        frontend/__tests__/components/sessions/SessionCard.test.tsx
git commit -m "$(cat <<'COMMIT_MSG'
feat(sessions): rewrite SessionCard with token-driven chrome

Replaces the pre-foundation-v1 implementation:
- Stage chip now uses the dimension-chip pattern (soft 15% fill +
  -deep text, no border) instead of the old indigo-everywhere
  treatment.
- Per-stage detail line under the date, sourced from stageDetail().
- Score block exposes data-score-variant so tests can assert the
  threshold logic; bar track + fill share the variant.
- Download button is a neutral pill (border-strong + fg-muted) with
  the Lucide Download icon. Renders only when stage === COMPLETE.
- Hover state darkens the border to fg-muted; the x delete affordance
  uses danger-deep on hover.

Behavior unchanged: same onOpen/onDeleted callbacks, same two-click
delete confirm, same wire format on getPipelineDownloadUrl.
COMMIT_MSG
)"
```

---

## Phase 4 — Home page rewrite

Replaces `frontend/app/page.tsx` with the new shell: simplified TopBar, IN PROGRESS / COMPLETE section split, EmptyState fallback.

### Task 4.1: Rewrite `page.tsx`

**Files:**
- Modify: `frontend/app/page.tsx` (full rewrite)

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/app/page.tsx
'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionsList } from '@/hooks/useSessionsList'
import { SessionCard } from '@/components/sessions/SessionCard'
import { SessionsTopBar } from '@/components/sessions/SessionsTopBar'
import { EmptyState } from '@/components/sessions/EmptyState'
import { UploadModal } from '@/components/sessions/UploadModal'
import { stageCategory } from '@/lib/stages'

export default function HomePage() {
  const router = useRouter()
  const { sessions, refresh } = useSessionsList()
  const [showUpload, setShowUpload] = useState(false)

  // One-time cleanup of a legacy localStorage key (no behavior change vs. prior page).
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('dq_sessions') } catch {}
  }

  const grouped = useMemo(() => {
    const inProgress = sessions.filter((s) => stageCategory(s.stage) !== 'complete')
    const complete   = sessions.filter((s) => stageCategory(s.stage) === 'complete')
    return { inProgress, complete }
  }, [sessions])

  function handleCreated(id: string) {
    refresh()
    setShowUpload(false)
    router.push(`/sessions/${id}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SessionsTopBar onNewSession={() => setShowUpload(true)} />

      {sessions.length === 0 ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : (
        <div className="flex-1 bg-canvas p-6 flex flex-col gap-5">
          {grouped.inProgress.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-widest text-fg-muted">In progress</div>
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {grouped.inProgress.map((s) => (
                  <SessionCard
                    key={s.id}
                    entry={s}
                    onOpen={() => router.push(`/sessions/${s.id}`)}
                    onDeleted={() => refresh()}
                  />
                ))}
              </div>
            </section>
          )}

          {grouped.complete.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-widest text-fg-muted">Complete</div>
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {grouped.complete.map((s) => (
                  <SessionCard
                    key={s.id}
                    entry={s}
                    onOpen={() => router.push(`/sessions/${s.id}`)}
                    onDeleted={() => refresh()}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showUpload && <UploadModal onCreated={handleCreated} onClose={() => setShowUpload(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: Type-check + full test suite**

```bash
cd frontend && npx tsc --noEmit && npx jest
```
Expected: tsc clean; sessions + stages tests all green; pre-existing useAIStream / useSessionList failures remain unchanged from baseline.

- [ ] **Step 3: Production build**

```bash
cd frontend && npm run build
```
Expected: build succeeds. The home page (`/`) is statically pre-rendered.

- [ ] **Step 4: Commit Phase 4**

```bash
git add frontend/app/page.tsx
git commit -m "feat(sessions): rewrite home page with section split + empty state

Replaces the old single-grid layout with:
- SessionsTopBar at the top (Logo + title + primary 'New session' CTA).
- Two sections: 'IN PROGRESS' (everything not yet COMPLETE) and
  'COMPLETE', each with its own auto-fill grid. Sections only render
  when they have at least one card.
- EmptyState centered in the viewport when there are no sessions yet.

Removes the inline dashed 'Upload a dataset' tile — the header CTA
and the empty-state CTA are the only creation affordances now.
Behavior preserved: same upload modal, same legacy localStorage
cleanup, same router push on creation."
```

---

## Phase 5 — Verification

### Task 5.1: Manual smoke test

- [ ] **Step 1: Start the dev server (preview route still not needed — real `/` route exercises everything)**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Walk through the scenarios**

1. **Empty state**: with no sessions, `localhost:3000/` shows the simplified TopBar + centered empty card with cloud-upload icon, headline, body, and primary "Upload a dataset" CTA. Both the header CTA and the empty-state CTA open the upload modal.

2. **Populated, mixed states**: with at least one in-progress session and one complete session, the page renders both `IN PROGRESS` and `COMPLETE` sections, each with its own grid. Section labels disappear when their group is empty.

3. **Chip palette**: a session whose stage is `AWAITING_RULE_APPROVAL` shows an amber `Awaiting Rules` chip; `VALIDATING` shows a blue `Validating` chip; `COMPLETE` shows a green `Complete` chip. All use soft 15% tinted fill, no border.

4. **Detail line**: the per-stage subtitle ('14 rules awaiting decision', 'Running validations…', '+18% over baseline') appears under the date when `stageDetail()` returns a string. For stages without a detail (e.g. `LOADING`), the row is hidden.

5. **Score threshold**: a session with score ≥ 0.9 shows the success palette throughout the score block; ≥ 0.7 shows warning; < 0.7 shows danger.

6. **Download**: only `COMPLETE` cards show the Download pill. Clicking it doesn't navigate to the session — it stops propagation and triggers the download.

7. **Delete**: hover over a card, the × appears top-right. First click flips to "Confirm?"; second click deletes and the card disappears. `onMouseLeave` resets the confirm state.

8. **Brand swap**: append `?client=clayton` to the URL, refresh, confirm the New session and Upload a dataset buttons render in Clayton navy.

- [ ] **Step 3: (optional) Tag rules-stage / sessions completion when verified**

```bash
git tag -a sessions-list-v1 -m "Round 2 Stage 2 — Sessions list redesign

Visual-parity redesign of the home page + SessionCard. Drops the
pre-foundation-v1 indigo gradient, retokenizes every alias, splits
the list into IN PROGRESS + COMPLETE, adds per-stage detail lines,
and centers a polished empty state. Includes the lib/stages.ts
utility shared with future workspace surfaces."
```

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Simplified TopBar | Task 1.1 (`SessionsTopBar`) + Task 4.1 (`page.tsx`) |
| Populated layout + RECENT SESSIONS label | Task 4.1 — note the label split into IN PROGRESS / COMPLETE per Figma iteration |
| Empty state | Tasks 2.1 + 2.2 (`EmptyState`) + Task 4.1 (mount) |
| Session card chrome | Task 3.2 |
| Stage palette (3 categories) | Task 0.2 (`stageCategory`) + Task 3.2 (chip class map) |
| Per-stage detail line (Figma addition) | Task 0.2 (`stageDetail`) + Task 3.2 (renders under date) |
| Score bar threshold logic | Task 3.2 (`scoreVariant`) + Task 3.1 (test) |
| Delete affordance preserved | Task 3.2 |
| Download (COMPLETE only) | Task 3.2 |
| Component boundaries (3 new files + 1 lib module) | Phases 0–4 file structure |
| Testing strategy | Tasks 0.1, 2.1, 3.1 |

**Pre-locked spec follow-ups** also addressed:
1. Lucide icon picks: `Upload` for the header / empty-state CTAs, `UploadCloud` for the empty-state large icon, `Download` for the card download pill — all confirmed present in `lucide-react@^1.16.0`.
2. `RECENT SESSIONS` label superseded by `IN PROGRESS` / `COMPLETE` per the Figma iteration; no count appended for v1 (parked).
3. `SessionsTopBar` lives as its own small component, not a shared base with workspace `TopBar`. Easy to merge later if a third home-shaped surface needs the same chrome.

**Placeholder scan:** every step has executable code, exact commands, and expected output. No TBDs or "similar to Task N" references.

**Type consistency:** `StageCategory = 'awaiting' | 'progress' | 'complete'` is defined once in `lib/stages.ts` and used by `stageCategory()` and `SessionCard.tsx`. `SessionLike` is the parameter shape for `stageDetail()` and any field referenced from it is optional. `ScoreVariant` is a local type inside `SessionCard.tsx`, not exported.

**Commit count:** 4 commits planned (stages utility, building blocks, SessionCard, page rewrite), aligning with Round 1 / Round 2 cadence.
