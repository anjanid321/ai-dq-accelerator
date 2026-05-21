# Validate Stage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Round 2 / Stage 6 — a retokenized `ValidateStage` with brand-primary spinner, dimension-chip result chips (PASSED → success-deep, FAILED → danger-deep, EVAL ERROR → warning-deep), token-based left-border accents, and accent-purple AI summary cards for both Validation Analysis and Anomaly Analysis prose. Wire into `/demo` so the walkthrough advances to Validate.

**Architecture:** Single-file rewrite. `ValidateStage.tsx` keeps its props (`session`, `readOnly`), its sort order, its data extraction from `session.validation_results` — every visual surface swapped to foundation tokens. Internal helpers (`CategoryPill`, `SampleRows`, `RuleCard`, `ProseSection`) stay inline (same call as Stage 5). The `/demo` workspace's active stage advances from `'rules'` to `'validate'` so the walkthrough lands on the new stage; Rules becomes a clickable past stage. A `DEMO_VALIDATE_SESSION` fixture mirrors the engineered anomalies in `samples/loan_applications.csv` so the rule pass/fail mix is realistic.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4 (foundation tokens — `text-fg`, `text-fg-muted`, `text-fg-subtle`, `bg-surface`, `bg-elevated`, `border-border`, `text-success-deep`, `bg-success/15`, `text-danger-deep`, `bg-danger/15`, `text-warning-deep`, `bg-warning/15`, `text-accent-purple-deep`, `bg-accent-purple/15`, `border-brand-primary`), Jest 30 + ts-jest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-19-validate-stage-redesign.md`

**Figma reference:** TBD — Figma frame is a separate phase after this stage tags. Slot reserved at (80, 6700) on page `02 — Foundation`.

---

## File Structure

```
frontend/
  components/
    stages/
      ValidateStage.tsx                # MODIFY — full rewrite (~180 lines)
  __tests__/
    stages/
      ValidateStage.test.tsx           # NEW — integration tests
  app/
    demo/
      page.tsx                         # MODIFY — advance active to 'validate', mount real ValidateStage
      _fixtures/
        mock-session.ts                # MODIFY — add DEMO_VALIDATE_SESSION fixture
```

Commit cadence — three commits + a verification phase + tag:

1. **`feat(validate): rewrite ValidateStage to token-driven chrome`** (Phase 1)
2. **`feat(demo): advance walkthrough to Validate stage`** (Phase 2)
3. Phase 3 is manual verification + final review + tag.

The Figma frame mirroring is a separate phase after `validate-stage-v1` ships.

---

## Phase 1 — `ValidateStage` rewrite

Full replacement of the 173-line file. Pure consumer of `session.validation_results`; no API calls, no state machine. TDD with all assertions written before the rewrite.

### Task 1.1: Write the failing integration test

**Files:**
- Create: `frontend/__tests__/stages/ValidateStage.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// frontend/__tests__/stages/ValidateStage.test.tsx
import { render, screen } from '@testing-library/react'
import { ValidateStage } from '@/components/stages/ValidateStage'
import type { SessionState, PerRuleResult } from '@/lib/types'

function makeRule(overrides: Partial<PerRuleResult>): PerRuleResult {
  return {
    id: 'r-default',
    category: 'validity',
    check: 'not_null',
    column: 'col',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: '',
    ...overrides,
  }
}

function makeSession(
  overrides: Partial<SessionState> & {
    validation_results?: SessionState['validation_results']
  } = {},
): SessionState {
  return {
    session_id: 'demo',
    stage: 'VALIDATING',
    profile: {},
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
  } as SessionState
}

describe('ValidateStage', () => {
  it('renders the brand-primary loading state when per_rule is empty', () => {
    render(<ValidateStage session={makeSession()} />)
    const spinner = screen.getByRole('status', { name: /validating/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/AI is running validation rules/)).toBeInTheDocument()
  })

  it('hides the loading state when per_rule has results', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1', column: 'email', check: 'not_null' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.queryByRole('status', { name: /validating/i })).toBeNull()
    expect(screen.getByText('Validation Results')).toBeInTheDocument()
  })

  it('renders the score header with rounded percent and baseline subline only when different', () => {
    const { rerender } = render(
      <ValidateStage
        session={makeSession({
          baseline_quality_score: 0.78,
          current_score: 0.85,
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0.78,
          },
        })}
      />,
    )
    expect(screen.getByText('85')).toBeInTheDocument()
    expect(screen.getByText(/baseline: 78%/)).toBeInTheDocument()

    // Same score = no baseline subline.
    rerender(
      <ValidateStage
        session={makeSession({
          baseline_quality_score: 0.78,
          current_score: 0.78,
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0.78,
          },
        })}
      />,
    )
    expect(screen.queryByText(/baseline:/)).toBeNull()
  })

  it('renders the counts row with passed / failed / errored spans in the right tokens', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({ id: 'p1', passed: true }),
              makeRule({ id: 'p2', passed: true }),
              makeRule({ id: 'f1', passed: false, failure_count: 6, failure_rate: 0.03 }),
              makeRule({ id: 'e1', passed: false, error: 'boom' }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('2 passed').className).toContain('text-success-deep')
    expect(screen.getByText('1 failed').className).toContain('text-danger-deep')
    expect(screen.getByText('1 errored').className).toContain('text-warning-deep')
    expect(screen.getByText(/of 4 rules/)).toBeInTheDocument()
  })

  it('hides the errored span when there are no eval errors', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'p1', passed: true })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.queryByText(/errored/)).toBeNull()
  })

  it('renders one category pill per category_scores entry, hides the row when empty', () => {
    const { rerender } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: { validity: 0.92, completeness: 1.0, uniqueness: 1.0 },
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('validity')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()
    expect(screen.getByText('completeness')).toBeInTheDocument()
    expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(2)

    rerender(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.queryByText('validity')).toBeNull()
  })

  it('sorts failures + errors before passed rules (failures first by failure_count desc)', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({ id: 'pass-a', column: 'pass_a', passed: true }),
              makeRule({
                id: 'fail-small', column: 'fail_small', passed: false,
                failure_count: 3, failure_rate: 0.015,
              }),
              makeRule({
                id: 'fail-big', column: 'fail_big', passed: false,
                failure_count: 80, failure_rate: 0.4,
              }),
              makeRule({ id: 'eval-err', column: 'err_col', passed: false, error: 'NameError' }),
              makeRule({ id: 'pass-b', column: 'pass_b', passed: true }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const columnNodes = screen.getAllByText(/^(pass_a|pass_b|fail_small|fail_big|err_col)$/)
    const order = columnNodes.map((n) => n.textContent)
    // failures + errors first, by failure_count desc; passed at the end
    expect(order[0]).toBe('fail_big')
    expect(order[1]).toBe('fail_small')
    expect(order[2]).toBe('err_col')
    expect(order.slice(3).sort()).toEqual(['pass_a', 'pass_b'])
  })

  it('renders a FAILED chip with danger-deep tokens and left-border on a failed rule', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'email', check: 'regex',
                passed: false, failure_count: 6, failure_rate: 0.03,
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const chip = screen.getByText(/FAILED · 6/)
    expect(chip.className).toContain('bg-danger/15')
    expect(chip.className).toContain('text-danger-deep')
    // Card has the left-border-token accent
    const card = container.querySelector('.border-l-danger-deep')
    expect(card).not.toBeNull()
    expect(screen.getByText('3.0% of rows')).toBeInTheDocument()
  })

  it('renders an EVAL ERROR chip with warning-deep tokens and the error block', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'custom', check: 'custom_code',
                passed: false, error: 'NameError: foo is not defined',
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const chip = screen.getByText('EVAL ERROR')
    expect(chip.className).toContain('bg-warning/15')
    expect(chip.className).toContain('text-warning-deep')
    expect(container.querySelector('.border-l-warning-deep')).not.toBeNull()
    const errorBlock = screen.getByText(/NameError: foo is not defined/)
    expect(errorBlock.className).toContain('bg-warning/15')
    expect(errorBlock.className).toContain('text-warning-deep')
    expect(errorBlock.className).toContain('font-mono')
  })

  it('renders a PASSED chip with success-deep tokens and left-border on a passed rule', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'application_id', check: 'unique',
                passed: true,
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const chip = screen.getByText('PASSED')
    expect(chip.className).toContain('bg-success/15')
    expect(chip.className).toContain('text-success-deep')
    expect(container.querySelector('.border-l-success-deep')).not.toBeNull()
  })

  it('renders sample failing rows for failed rules with sample_failing_rows entries', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'email', check: 'regex',
                passed: false, failure_count: 2, failure_rate: 0.01,
                sample_failing_rows: [
                  { email: 'not.an.email', application_id: 'LA-000005' },
                  { email: 'also-bad', application_id: 'LA-000017' },
                ],
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('email')).toBeInTheDocument() // table header
    expect(screen.getByText('not.an.email')).toBeInTheDocument()
    expect(screen.getByText('also-bad')).toBeInTheDocument()
  })

  it('puts the target column first in the sample-failing-rows header', () => {
    const { container } = render(
      <ValidateStage
        session={makeSession({
          validation_results: {
            per_rule: [
              makeRule({
                id: 'r1', column: 'application_date', check: 'range',
                passed: false, failure_count: 1, failure_rate: 0.005,
                sample_failing_rows: [
                  { application_id: 'LA-000003', application_date: '2030-04-15', credit_score: 720 },
                ],
              }),
            ],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)
    expect(headers[0]).toBe('application_date')
  })

  it('renders both AI prose cards with accent-purple tokens and the ✦ section labels', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_summary: 'Most rules passed; format issues on email and phone account for the bulk of failures.',
          anomaly_summary: 'Two low-credit APPROVED rows look like data-entry mistakes worth surfacing to the underwriter.',
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    const validationLabel = screen.getByText('✦ VALIDATION ANALYSIS')
    expect(validationLabel.className).toContain('text-accent-purple-deep')
    const validationBody = screen.getByText(/format issues on email/)
    expect(validationBody.className).toContain('text-accent-purple-deep')

    const anomalyLabel = screen.getByText('✦ ANOMALY ANALYSIS')
    expect(anomalyLabel.className).toContain('text-accent-purple-deep')
    expect(screen.getByText(/data-entry mistakes/)).toBeInTheDocument()
  })

  it('hides each AI prose card independently when its body is empty', () => {
    render(
      <ValidateStage
        session={makeSession({
          validation_summary: 'Only the validation analysis is set.',
          anomaly_summary: '',
          validation_results: {
            per_rule: [makeRule({ id: 'r1' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('✦ VALIDATION ANALYSIS')).toBeInTheDocument()
    expect(screen.queryByText('✦ ANOMALY ANALYSIS')).toBeNull()
  })

  it('accepts readOnly without crashing — rule list still renders', () => {
    render(
      <ValidateStage
        readOnly
        session={makeSession({
          validation_results: {
            per_rule: [makeRule({ id: 'r1', column: 'email' })],
            category_scores: {},
            baseline_quality_score: 0,
          },
        })}
      />,
    )
    expect(screen.getByText('email')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/stages/ValidateStage.test.tsx
```

Expected: FAIL — the current `ValidateStage` uses legacy tokens (`text-text-*`, `bg-surface-raised`, `border-l-amber-500`, `bg-red-500/15`, `text-amber-400`, etc.), has no `role="status"` on the spinner, doesn't render a `Validation Results` heading, doesn't use the accent-purple class on the prose sections, and uses `border-l-success` rather than `border-l-success-deep`. Many class-name assertions should fail.

### Task 1.2: Rewrite `ValidateStage.tsx`

**Files:**
- Modify: `frontend/components/stages/ValidateStage.tsx` (full rewrite)

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/components/stages/ValidateStage.tsx
'use client'
import type { SessionState, PerRuleResult } from '@/lib/types'

interface Props {
  session: SessionState | null
  // Accepted for source-compat with SnapshotStageView; unused — Validate has
  // no human actions to suppress.
  readOnly?: boolean
}

function CategoryPill({ label, score }: { label: string; score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-elevated text-[11px] text-fg-muted border border-border">
      <span className="capitalize">{label}</span>
      <span className="font-semibold text-fg">{Math.round(score * 100)}%</span>
    </span>
  )
}

function SampleRows({
  rows,
  targetColumn,
}: {
  rows: Record<string, unknown>[]
  targetColumn?: string
}) {
  if (!rows.length) return null
  const allKeys = Object.keys(rows[0])
  const keys =
    targetColumn && allKeys.includes(targetColumn)
      ? [targetColumn, ...allKeys.filter((k) => k !== targetColumn).slice(0, 2)]
      : allKeys.slice(0, 3)

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {keys.map((k) => (
              <th
                key={k}
                className="text-left px-2 py-1 text-fg-muted font-medium border-b border-border"
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 3).map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {keys.map((k) => (
                <td
                  key={k}
                  className="px-2 py-1 text-fg-muted font-mono truncate max-w-[160px]"
                >
                  {row[k] === null || row[k] === undefined ? (
                    <span className="italic text-fg-subtle">null</span>
                  ) : (
                    String(row[k])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RuleCard({ rule }: { rule: PerRuleResult }) {
  const hasError = !!rule.error
  const failed = !rule.passed && !hasError

  const borderColor = hasError
    ? 'border-l-warning-deep'
    : failed
      ? 'border-l-danger-deep'
      : 'border-l-success-deep'

  const chipClasses = hasError
    ? 'bg-warning/15 text-warning-deep border border-warning/30'
    : failed
      ? 'bg-danger/15 text-danger-deep border border-danger/30'
      : 'bg-success/15 text-success-deep border border-success/30'

  return (
    <div
      className={`bg-surface border border-border rounded-lg p-3 border-l-2 ${borderColor}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-fg truncate">
            {rule.column ?? 'table-level'}
          </span>
          <span className="text-xs text-fg-subtle font-mono">{rule.check}</span>
          {rule.rationale && (
            <span className="text-xs text-fg-muted leading-snug">{rule.rationale}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {failed && (
            <span className="text-xs text-fg-muted">
              {(rule.failure_rate * 100).toFixed(1)}% of rows
            </span>
          )}
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${chipClasses}`}
          >
            {hasError ? 'EVAL ERROR' : failed ? `FAILED · ${rule.failure_count}` : 'PASSED'}
          </span>
        </div>
      </div>
      {hasError && (
        <div className="mt-2 rounded-md bg-warning/15 border border-warning/30 px-2 py-1.5 text-[11px] font-mono text-warning-deep break-all">
          {rule.error}
        </div>
      )}
      {!hasError && failed && rule.sample_failing_rows.length > 0 && (
        <SampleRows rows={rule.sample_failing_rows} targetColumn={rule.column ?? undefined} />
      )}
    </div>
  )
}

function ProseSection({ label, body }: { label: string; body: string }) {
  if (!body) return null
  return (
    <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-xl p-4 flex flex-col gap-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-accent-purple-deep">
        {label}
      </div>
      <p className="text-xs text-accent-purple-deep leading-relaxed whitespace-pre-wrap">
        {body}
      </p>
    </div>
  )
}

export function ValidateStage({ session }: Props) {
  const results = session?.validation_results
  const perRule = results?.per_rule

  if (!perRule?.length) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Validating"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">
            AI is running validation rules against your dataset…
          </span>
        </div>
      </div>
    )
  }

  const score = session?.current_score ?? session?.baseline_quality_score ?? 0
  const baseline = session?.baseline_quality_score ?? 0
  const errored = perRule.filter((r) => !!r.error).length
  const passed = perRule.filter((r) => r.passed && !r.error).length
  const failed = perRule.length - passed - errored
  const categoryScores = results?.category_scores ?? {}
  const sortedRules = [...perRule].sort((a, b) => {
    const aTop = !a.passed || !!a.error
    const bTop = !b.passed || !!b.error
    if (aTop !== bTop) return aTop ? -1 : 1
    return b.failure_count - a.failure_count
  })

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl mx-auto">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Validation Results</h1>
        <p className="text-xs text-fg-muted">
          How your dataset performs against the proposed rules.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-5xl font-bold text-fg">
              {Math.round(score * 100)}
              <span className="text-2xl text-fg-muted">%</span>
            </div>
            {score !== baseline && (
              <div className="text-xs text-fg-subtle mt-1">
                baseline: {Math.round(baseline * 100)}%
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
              Quality Score
            </div>
            <div className="text-sm text-fg-muted">
              <span className="text-success-deep font-semibold">{passed} passed</span>
              {' · '}
              <span className="text-danger-deep font-semibold">{failed} failed</span>
              {errored > 0 && (
                <>
                  {' · '}
                  <span className="text-warning-deep font-semibold">{errored} errored</span>
                </>
              )}
              <span className="text-fg-subtle"> of {perRule.length} rules</span>
            </div>
          </div>
        </div>
        {Object.keys(categoryScores).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {Object.entries(categoryScores).map(([cat, s]) => (
              <CategoryPill key={cat} label={cat} score={s} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {sortedRules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} />
        ))}
      </div>

      <ProseSection label="✦ VALIDATION ANALYSIS" body={session?.validation_summary ?? ''} />
      <ProseSection label="✦ ANOMALY ANALYSIS" body={session?.anomaly_summary ?? ''} />
    </div>
  )
}
```

- [ ] **Step 2: Verify ValidateStage tests pass**

```bash
cd frontend && npx jest __tests__/stages/ValidateStage.test.tsx
```

Expected: 15/15 pass.

- [ ] **Step 3: Full suite + type-check + build**

```bash
cd frontend && npx tsc --noEmit && npx jest && npm run build
```

Expected:
- `tsc`: clean for new / modified files. The pre-existing `.next/types/validator.ts` warning is a stale Next.js artifact from an earlier stage's deleted preview route — ignore; `npm run build` regenerates clean.
- `jest`: pre-existing `__tests__/hooks/useAIStream.test.ts` failure remains the only red. Going-in baseline: 175 passing / 1 failing. After Stage 6: ~189 passing / 1 failing (+15 new ValidateStage assertions, though jest may expand some inferred test cases differently — exact count within ±1).
- `npm run build`: succeeds.

- [ ] **Step 4: Commit Phase 1**

```bash
git add frontend/components/stages/ValidateStage.tsx \
        frontend/__tests__/stages/ValidateStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(validate): rewrite ValidateStage to token-driven chrome

Replaces the pre-foundation-v1 implementation:
- Heading + subhead added with the established Round 2 pattern
  (text-base font-bold text-fg + text-xs text-fg-muted).
- Score header card retokenized: bg-surface-raised → bg-surface,
  text-text → text-fg, text-text-muted → text-fg-muted /-subtle,
  counts row tokens text-success / text-red-400 / text-amber-400 →
  text-success-deep / text-danger-deep / text-warning-deep with the
  Quality Score label in the standard section-label vocabulary.
- Category pill changes from bg-surface-raised text-text-muted to
  the neutral elevated-chip pattern bg-elevated text-fg-muted with
  the value highlighted in text-fg.
- Rule cards: wrapper bg-surface-raised → bg-surface; left-border
  accent changes from Tailwind hex (border-l-amber-500 /
  border-l-red-500 / border-l-success) to foundation tokens
  (border-l-warning-deep / border-l-danger-deep / border-l-success-deep);
  result chips switch from inline hex (bg-amber-500/15 text-amber-400)
  to the dimension-chip pattern (bg-{warning,danger,success}/15 +
  text-{warning,danger,success}-deep + matching /30 border).
- Eval-error block uses the dimension-chip warning-deep palette
  instead of bg-amber-500/10 text-amber-300.
- Sample failing rows table retokenized: header text-text-muted/70 →
  text-fg-muted, body cells text-text-muted → text-fg-muted, null
  literal text-text-muted/50 → text-fg-subtle.
- AI prose sections promoted to accent-purple cards (bg-accent-purple/15
  border-accent-purple/30 text-accent-purple-deep) with ✦ section
  labels — matches Profile's AI summary semantics since both
  validation_summary and anomaly_summary are AI-generated prose.
- Loading state spinner ring is brand-primary (matches Load + Profile
  + Explore) with role="status" + aria-label="Validating". Drops the
  redundant "AI panel on the right shows live progress" hint copy.

Behavior preserved verbatim: same Props ({session, readOnly}), same
sort order (failures + errors first, by failure_count desc), same data
extraction from session.validation_results, same sample-row column
selection (target column first, max 3 rows). readOnly stays accepted
but unused — no actions exist on this stage (Validate auto-transitions
to Triage).

15 new integration tests cover loading, header / counts / category
pills, sort order, every rule-card state (PASSED / FAILED / EVAL
ERROR) including class assertions for chip + left-border tokens,
sample-row column ordering, AI prose card visibility + accent-purple
token assertions, and readOnly pass-through. Pre-existing useAIStream
red unchanged.
EOF
)"
```

---

## Phase 2 — Wire into `/demo`

The walkthrough's active stage advances from `'rules'` to `'validate'`. Rules becomes a clickable past stage (the user can still click back to review). A new `DEMO_VALIDATE_SESSION` fixture mirrors the engineered anomalies in `samples/loan_applications.csv` so the rule pass/fail mix reads realistically.

### Task 2.1: Add the `DEMO_VALIDATE_SESSION` fixture

**Files:**
- Modify: `frontend/app/demo/_fixtures/mock-session.ts`

- [ ] **Step 1: Append the new fixture below `DEMO_RULES_SESSION`**

Find the existing `export const DEMO_RULES_SESSION: SessionState = {` block in `frontend/app/demo/_fixtures/mock-session.ts`. After its closing brace, add:

```ts
// Validation results mirror the engineered anomalies in
// samples/loan_applications.csv so the pass/fail mix reads true to life.
import type { PerRuleResult, ValidationResults } from '@/lib/types'

const DEMO_PER_RULE: PerRuleResult[] = [
  {
    id: 'r1',
    category: 'uniqueness',
    column: 'application_id',
    check: 'unique',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'application_id is 100% distinct in profiling — enforce uniqueness so future inserts can\'t collide.',
  },
  {
    id: 'r2',
    category: 'completeness',
    column: 'applicant_name',
    check: 'not_null',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'applicant_name is 0% missing today — pin completeness at 100%.',
  },
  {
    id: 'r3',
    category: 'completeness',
    column: 'state_code',
    check: 'not_null',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'state_code is 0% missing and constant — enforce completeness.',
  },
  {
    id: 'r4',
    category: 'validity',
    column: 'credit_score',
    check: 'range(300, 850)',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'FICO scores fall in 300–850. Tolerate 1% out-of-range for legacy data import errors.',
  },
  {
    id: 'r5',
    category: 'validity',
    column: 'application_date',
    check: 'max_date(today)',
    passed: false,
    failure_count: 3,
    failure_rate: 0.015,
    sample_failing_rows: [
      { application_id: 'LA-000017', application_date: '2030-04-15', credit_score: 720 },
      { application_id: 'LA-000089', application_date: '2030-08-02', credit_score: 685 },
      { application_id: 'LA-000142', application_date: '2030-12-21', credit_score: 740 },
    ],
    rationale: 'application_date should never be in the future. 3 rows fail this and need to be clipped.',
  },
  {
    id: 'r6',
    category: 'validity',
    column: 'email',
    check: 'regex(email)',
    passed: false,
    failure_count: 6,
    failure_rate: 0.03,
    sample_failing_rows: [
      { application_id: 'LA-000005', email: 'maria.gonzalez.invalid', applicant_name: 'Maria Gonzalez' },
      { application_id: 'LA-000031', email: 'jin.park.invalid', applicant_name: 'Jin Park' },
      { application_id: 'LA-000077', email: 'thandiwe.mokoena.invalid', applicant_name: 'Thandiwe Mokoena' },
    ],
    rationale: '6 rows fail standard email format. Tolerate 5% to leave room for missing values.',
  },
  {
    id: 'r7',
    category: 'consistency',
    column: 'phone',
    check: 'format((XXX) XXX-XXXX)',
    passed: false,
    failure_count: 152,
    failure_rate: 0.76,
    sample_failing_rows: [
      { application_id: 'LA-000003', phone: '7035551234', applicant_name: 'Ahmed Hassan' },
      { application_id: 'LA-000011', phone: '703.555.4821', applicant_name: 'Priya Patel' },
      { application_id: 'LA-000024', phone: '+1-703-555-9912', applicant_name: 'Carlos Rivera' },
    ],
    rationale: 'phone shows 5 different formats. Normalize toward (XXX) XXX-XXXX before re-validating.',
  },
  {
    id: 'r8',
    category: 'validity',
    column: 'loan_status',
    check: 'in([APPROVED, REJECTED, PENDING])',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'loan_status has 3 distinct values today — pin the allowed set.',
  },
  {
    id: 'r9-eval',
    category: 'consistency',
    column: 'co_signer_ssn',
    check: 'custom_code(format_check)',
    passed: false,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'Custom SSN-format check; failed to compile against the sandboxed environment.',
    error: "NameError: name 're' is not defined (sandbox blocks the `re` import — rewrite without regex).",
  },
]

const DEMO_VALIDATION_RESULTS: ValidationResults = {
  per_rule: DEMO_PER_RULE,
  category_scores: {
    completeness: 1.0,
    uniqueness: 1.0,
    validity: 0.78,
    consistency: 0.5,
  },
  baseline_quality_score: 0.78,
}

export const DEMO_VALIDATE_SESSION: SessionState = {
  ...baseSession('VALIDATING'),
  ai_summary: DEMO_AI_SUMMARY,
  suggested_rules: DEMO_RULES,
  baseline_quality_score: 0.78,
  current_score: 0.82,
  validation_summary:
    'The dataset clears the structural rules — application_id is unique, completeness on applicant_name and state_code is at 100%, and loan_status falls in the allowed value set. Failures cluster on format consistency: phone shows five different formats (76% of rows), email has 6 malformed values, and 3 application_date entries are in the future. One custom rule failed to evaluate in the sandbox.',
  anomaly_summary:
    'Two applications with credit_score < 600 are marked APPROVED — worth surfacing to the underwriter before the rules pipeline locks in. The cross-column pattern is unusual enough to be either an exception path or an intake mistake, not a data-quality issue per se.',
  validation_results: DEMO_VALIDATION_RESULTS,
}
```

The `baseSession` helper, `DEMO_AI_SUMMARY`, and `DEMO_RULES` are already exported / defined in the same file — no new imports beyond the type addition at the top of the block.

- [ ] **Step 2: Move the `PerRuleResult, ValidationResults` import to the top of the file**

Find the existing top-of-file import:

```ts
import type { SessionState, Rule, SessionListEntry } from '@/lib/types'
```

Replace with:

```ts
import type { SessionState, Rule, SessionListEntry, PerRuleResult, ValidationResults } from '@/lib/types'
```

Then delete the inline `import type { PerRuleResult, ValidationResults } from '@/lib/types'` line you just added above `DEMO_PER_RULE` (imports belong at the top in this codebase).

- [ ] **Step 3: Verify the fixture compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean. If TS complains about a missing `PerRuleResult` field, add the missing fields with defaults (`rationale: ''`, etc.) — the existing type at `frontend/lib/types.ts:71` is the source of truth.

### Task 2.2: Advance `/demo` workspace to the Validate stage

**Files:**
- Modify: `frontend/app/demo/page.tsx`

- [ ] **Step 1: Import the new fixture and the ValidateStage component**

Find the existing imports block at the top of `frontend/app/demo/page.tsx`. Add the new component import alongside the others:

```ts
import { ValidateStage } from '@/components/stages/ValidateStage'
```

Then update the fixture-import block:

```ts
import {
  DEMO_AI_EVENTS,
  DEMO_EXPLORE_STATE,
  DEMO_FILENAME,
  DEMO_PROFILE_SESSION,
  DEMO_PROFILE_TABLE,
  DEMO_RULES_SESSION,
  DEMO_SESSIONS_LIST,
  DEMO_VALIDATE_SESSION,
} from './_fixtures/mock-session'
```

- [ ] **Step 2: Add `'validate'` to the demo's in-scope stage list**

Find:

```ts
const DEMO_STAGES: StageId[] = ['load', 'profile', 'explore', 'rules']
```

Replace with:

```ts
const DEMO_STAGES: StageId[] = ['load', 'profile', 'explore', 'rules', 'validate']
```

- [ ] **Step 3: Update the WAITING_MESSAGES map**

Find:

```ts
const WAITING_MESSAGES: Record<StageId, string | undefined> = {
  load: 'Loading dataset…',
  profile: 'Profiling complete',
  explore: 'Awaiting exploration review',
  rules: 'Awaiting rule decisions',
  validate: undefined,
  triage: undefined,
  ...
}
```

Change `validate: undefined` to:

```ts
  validate: 'Running validation rules…',
```

(Leave the other `undefined` entries as-is — they're out of demo scope.)

- [ ] **Step 4: Advance ACTIVE_STAGE to 'validate'**

Find:

```ts
const ACTIVE_STAGE: StageId = 'rules'
```

Replace with:

```ts
const ACTIVE_STAGE: StageId = 'validate'
```

(The `COMPLETED_STAGES` line right below it uses `STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(ACTIVE_STAGE))` so it'll automatically expand to include `'rules'` as a completed/clickable past stage. No other change needed there.)

- [ ] **Step 5: Update the TopBar score binding**

Find:

```tsx
currentScore={DEMO_RULES_SESSION.current_score}
```

Replace with:

```tsx
currentScore={DEMO_VALIDATE_SESSION.current_score}
```

(The score on the TopBar should reflect the live workflow position — now Validate.)

- [ ] **Step 6: Add the `'validate'` case to `renderStage()`**

Find the `switch (viewingStage) {` block. After the `case 'rules':` block (which returns `<RulesStage session={DEMO_RULES_SESSION} readOnly />`), add a new case:

```tsx
      case 'validate':
        return <ValidateStage session={DEMO_VALIDATE_SESSION} />
```

- [ ] **Step 7: Verify the build**

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Expected: tsc clean, build succeeds, `/demo` route still emits.

- [ ] **Step 8: Spot-check the full test suite still passes**

```bash
cd frontend && npx jest
```

Expected: same 189-ish passing / 1 failing as after Phase 1 — no new tests, but make sure the demo-page change didn't break the existing suite.

- [ ] **Step 9: Commit Phase 2**

```bash
git add frontend/app/demo/page.tsx frontend/app/demo/_fixtures/mock-session.ts
git commit -m "$(cat <<'EOF'
feat(demo): advance walkthrough to Validate stage

The demo's live workflow position moves from Rules to Validate.
Rules becomes a clickable past stage in the stepper; Validate is
the new default landing stage. Adds DEMO_VALIDATE_SESSION fixture
with 9 PerRuleResult entries mirroring the engineered anomalies in
samples/loan_applications.csv (5 PASSED, 3 FAILED with sample
failing rows, 1 EVAL ERROR with a sandbox-style traceback) plus
validation_summary + anomaly_summary prose that surface the
cross-column credit/APPROVED quirk for the Anomaly Analysis card.
Category scores cover completeness / uniqueness / validity /
consistency to exercise the pill row.

TopBar currentScore now tracks DEMO_VALIDATE_SESSION (0.82, up from
the 0.78 baseline). Stepper substatus reads "Running validation
rules…" while on Validate.
EOF
)"
```

---

## Phase 3 — Verification + final review + tag

No code changes. Walk through the demo, run the cross-stage code review, then tag.

### Task 3.1: Manual smoke test

- [ ] **Step 1: Pull the branch into the primary checkout and start the dev server**

```bash
cd ~/Downloads/GitHub/ai-dq-accelerator
git pull /Users/anjani.dabkara/ai-dq-accelerator claude/kind-brattain-7675b4 --ff-only
npm --prefix frontend run dev
```

Open `http://localhost:3000/demo` → click any session card → land on the Validate stage by default.

- [ ] **Step 2: Walk through the Validate stage scenarios**

1. **Default view (Validate active)** — Score header reads 82% with the `baseline: 78%` subline; counts row shows `5 passed · 3 failed · 1 errored of 9 rules` with the right token colors (success-deep / danger-deep / warning-deep); category pills render in the neutral elevated-chip pattern (completeness 100% / uniqueness 100% / validity 78% / consistency 50%).
2. **Rule list ordering** — Failures + the eval error appear first (sorted by failure_count desc): `phone` (FAILED · 152), `email` (FAILED · 6), `application_date` (FAILED · 3), then `co_signer_ssn` (EVAL ERROR), then the 5 PASSED rules.
3. **Failed rule** — `phone` card has the left-border in `border-l-danger-deep`, FAILED · 152 chip in `bg-danger/15 + text-danger-deep`, the 76.0% rate, and a 3-row sample-failing-rows table with `application_id`, `phone`, `applicant_name` columns.
4. **Eval-error rule** — `co_signer_ssn` card has the left-border in `border-l-warning-deep`, EVAL ERROR chip in `bg-warning/15 + text-warning-deep`, and the error message rendered in the warning-tinted monospace block.
5. **Passed rule** — `application_id` (and the other 4 passed rules) have left-border in `border-l-success-deep`, PASSED chip in `bg-success/15 + text-success-deep`, no failure-rate label.
6. **AI prose** — Both cards render in the purple `bg-accent-purple/15` palette with the `✦ VALIDATION ANALYSIS` and `✦ ANOMALY ANALYSIS` section labels. Body text in `text-accent-purple-deep leading-relaxed`.
7. **Stepper** — load / profile / explore / rules all show the green check; validate is active (orange dot); triage / plan / transform / scorecard / pipeline are locked.
8. **Click back to Rules** — Rules is clickable; clicking jumps to the past view with the existing warning banner ("Viewing past stage — validate is the active stage"). Click "Return →" to come back.

If any of these don't render correctly, file the issue and fix in-branch before tagging.

### Task 3.2: Final cross-stage code review

- [ ] **Step 1: Dispatch the `superpowers:code-reviewer` agent**

Run the final review per the user-locked pattern (no per-task reviews; one final review at end). The reviewer should check:

- Spec compliance against `docs/superpowers/specs/2026-05-19-validate-stage-redesign.md`
- All 15 test cases pass
- Token usage clean: zero legacy `text-text-*`, `bg-surface-raised`, `border-l-amber-500`, `border-l-red-500`, `bg-amber-500/15`, `bg-red-500/15`, `text-amber-400`, `text-red-400`, `border-indigo` references
- Behavior preserved: same Props, same sort order, same data extraction
- `readOnly` accepted but unused (no behavior branching on it)
- `tsc --noEmit` clean, full suite at baseline (~189/190 — the pre-existing useAIStream red is the only failure)
- `npm run build` succeeds

If APPROVED, proceed to tag. If CHANGES_REQUESTED, fix and re-review.

### Task 3.3: Tag `validate-stage-v1`

- [ ] **Step 1: Create the annotated tag**

```bash
git tag -a validate-stage-v1 -m "$(cat <<'EOF'
Round 2 Stage 6 — Validate stage redesign

Retokenized ValidateStage with:
- Brand-primary spinner ring on the loading state with role=status +
  aria-label=Validating (matches Load + Profile + Explore patterns).
- Score header card in the established Round 2 vocabulary (bg-surface
  + section-label typography), counts row using text-success-deep /
  text-danger-deep / text-warning-deep, baseline subline in
  text-fg-subtle.
- Neutral elevated-chip category pills (bg-elevated + border + value
  highlighted in text-fg).
- Rule cards with token-driven left-border accents (border-l-success-
  deep / border-l-danger-deep / border-l-warning-deep) and dimension-
  chip result chips (PASSED / FAILED · N / EVAL ERROR) in the bg/15
  + text-deep + /30 border pattern that matches Profile alerts and
  Explore Open Questions.
- Eval-error block in the dimension-chip warning palette instead of
  hex amber.
- Sample failing rows table retokenized (text-fg-muted header /
  body, text-fg-subtle null literal).
- AI prose sections promoted to accent-purple cards with ✦ section
  labels (matches Profile's AI summary semantics since both
  validation_summary and anomaly_summary are AI-generated prose).
- Redundant "AI panel on the right" hint dropped from loading copy.

Behavior preserved verbatim: same Props ({session, readOnly}), same
sort order (failures + errors first, by failure_count desc), same
sample-row column selection. readOnly stays accepted but unused.

The /demo workspace now lands on Validate by default (active stage
advances from Rules to Validate; Rules becomes a clickable past
stage). DEMO_VALIDATE_SESSION fixture mirrors the engineered
anomalies in samples/loan_applications.csv with 9 rules (5 PASSED,
3 FAILED including phone-format and future-date failures, 1 EVAL
ERROR) plus AI prose for both card sections.

15 new integration tests; full suite 189/190 passing (the pre-
existing useAIStream red predates Round 1).
EOF
)" && git tag --list 'validate-stage-v1'
```

- [ ] **Step 2: Confirm the tag**

```bash
git show validate-stage-v1 --no-patch --format="%H %s"
```

Expected: prints the SHA of the most recent commit (the Phase 2 demo wiring) and its title.

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Loading state — brand-primary spinner + role=status + aria-label | Task 1.2 (loading branch) + Task 1.1 (spinner-class assertion + role=status query) |
| Header block — title + subhead | Task 1.2 (`<div className="flex flex-col gap-0.5">` block) + Task 1.1 (heading assertion) |
| Score header card retokenize | Task 1.2 (`<div className="bg-surface ...">`) + Task 1.1 (score-and-baseline test) |
| Counts row tokens (passed/failed/errored → deep variants) | Task 1.2 (counts row) + Task 1.1 (token-class assertion per span) |
| `errored` hidden when zero | Task 1.2 (`errored > 0 &&`) + Task 1.1 (hides-when-zero test) |
| Category pills retokenize + hide when empty | Task 1.2 (`CategoryPill` + conditional row) + Task 1.1 (pill-render + empty-row tests) |
| Rule sort (failures + errors first, failure_count desc) | Task 1.2 (`sortedRules` sort) + Task 1.1 (sort-order test) |
| FAILED chip + left-border tokens | Task 1.2 (`RuleCard` chip ternary + `borderColor` ternary) + Task 1.1 (FAILED-chip token + left-border-token assertions) |
| EVAL ERROR chip + warning-deep block | Task 1.2 (chip + eval-error block) + Task 1.1 (EVAL ERROR token assertions) |
| PASSED chip + left-border tokens | Task 1.2 + Task 1.1 (PASSED-chip token + left-border-token assertions) |
| Sample failing rows table retokenize + column ordering | Task 1.2 (`SampleRows`) + Task 1.1 (table render + target-first column tests) |
| AI prose cards — accent-purple + ✦ section labels | Task 1.2 (`ProseSection`) + Task 1.1 (token + label assertions) |
| AI prose cards hide independently when body empty | Task 1.2 (early return in `ProseSection`) + Task 1.1 (independent-hide test) |
| `readOnly` accepted without crashing | Task 1.2 (prop declared, unused) + Task 1.1 (readOnly pass-through test) |
| `/demo` advances to Validate | Phase 2 (ACTIVE_STAGE update + render case + fixture) |
| Figma frame at (80, 6700) | Out of plan scope — separate phase after the tag |

**Placeholder scan:** Every step contains either complete code or an exact command + expected output. No TBDs, no "similar to Task N", no `// add error handling here` stubs.

**Type consistency:**
- `PerRuleResult` and `ValidationResults` types come from `frontend/lib/types.ts` — single source of truth. The plan's fixture uses every required field (no missing properties; TS will catch any drift on the tsc step).
- `SessionState` cast in `makeSession` matches the existing fixture pattern used in `ProfileStage.test.tsx`.
- The new `validate: 'Running validation rules…'` entry in `WAITING_MESSAGES` lines up with the `Record<StageId, string | undefined>` type — no type changes needed.
- `DEMO_VALIDATE_SESSION` follows the `baseSession()` factory pattern already used by `DEMO_PROFILE_SESSION` and `DEMO_RULES_SESSION` — consistent.

**Commit count:** Two `feat` commits + one tag, matches the Stage 5 cadence and the recent Upload Modal cadence.

**Out-of-scope reminders for the implementer:**
- Do **not** add a Continue button. Validate has no human gate — workflow auto-transitions to Triage. If a future spec adds one, separate change.
- Do **not** branch on `readOnly`. It's accepted for source-compat with `SnapshotStageView` but the stage has no actions to suppress. Tests assert the prop is accepted without crashing — that's the contract.
- Do **not** restructure the rule list (no grouping, no filter chips, no collapsible sections). Flat sorted list stays — same scope choice as Stage 5.
- Do **not** swap the 5xl mega-score for a stats grid — out of scope (spec explicitly punts this to a future change).
- Do **not** fix the `text-{success,warning,danger}-deep` contrast on `*/15` fills — borderline WCAG AA queued as the post-Round-2 a11y mini-stage.
- Do **not** add a Figma frame in this branch. Mirror lands as a separate phase after the tag, same cadence as `upload-modal-v1`.
