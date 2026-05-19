# Explore Stage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Round 2 / Stage 5 — a retokenized `ExplorationStage` that matches Stages 1–4 (foundation tokens, dimension-chip alert cards, brand-primary spinners, primary-navy Approve CTA, neutral secondary Re-investigate) with no behavior changes.

**Architecture:** Single-file rewrite. `frontend/components/stages/ExplorationStage.tsx` keeps its props (`sessionId`, `stage`, `readOnly`), its polling effect, its submit handlers, and the Open Questions / Constraint Warning / Notebook / Feedback / Action Row / Submitted-state sections — all chrome swapped to foundation tokens. No internal helpers extracted (the file goes from 218 → ~150 lines, small enough to stay one file). A temporary `frontend/app/preview/explore/page.tsx` ships during iteration so the user can review the rebuild without a running backend, then is removed in a chore commit before tagging.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4 (foundation tokens — `text-fg`, `text-fg-muted`, `text-fg-subtle`, `bg-surface`, `bg-elevated`, `border-border`, `text-warning-deep`, `bg-warning/15`, `text-danger-deep`, `bg-danger/15`, `bg-brand-accent`, `text-on-brand`, `border-brand-primary`, `focus:border-brand-primary`), lucide-react (`ArrowRight`, `RefreshCw`, `Download`), Jest 30 + ts-jest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-19-explore-stage-redesign.md`

**Figma reference:** `Explore / 1440x900 / Default` (`147:269`) on page `02 — Foundation` of `gsnW43uSpvdLpwandZM8Zx`.

---

## File Structure

```
frontend/
  components/
    stages/
      ExplorationStage.tsx              # MODIFY — full rewrite (~150 lines)
  app/
    preview/
      explore/
        page.tsx                        # NEW (temporary) — drop before tag
  __tests__/
    stages/
      ExplorationStage.test.tsx         # NEW — page integration
```

Path alias `@/` resolves to `frontend/`. Tailwind content glob already covers `./components/**/*.tsx` and `./app/**/*.tsx`.

Commit cadence — three commits + a verification phase + a cleanup commit before the tag:

1. **`feat(explore): rewrite ExplorationStage to token-driven chrome`** (Phase 1 — rewrite + tests)
2. **`chore(preview): add temporary Explore stage preview route`** (Phase 2 — preview)
3. **`chore(preview): remove temporary Explore stage preview route`** (Phase 3 — after verification)
4. Tag `explore-stage-v1` (no commit).

If the user requests Figma-spacing tweaks after reviewing the preview (Stage 4 pattern, ref commit `12f9e97`), insert a `fix(explore): mirror Figma spacing tweaks in ExplorationStage` commit between Phases 2 and 3.

---

## Phase 1 — `ExplorationStage` rewrite

Full replacement of the existing 218-line file. The component still polls every 3 seconds until `notebook_ready`, still gates on `readOnly` / `maxRoundsReached`, still surfaces Open Questions and Constraint Warning, still uses the same submit handlers — every visual surface is retokenized.

### Task 1.1: Write the failing integration test

**Files:**
- Create: `frontend/__tests__/stages/ExplorationStage.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/stages/ExplorationStage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExplorationStage } from '@/components/stages/ExplorationStage'
import * as api from '@/lib/api'

jest.mock('@/lib/api', () => ({
  getExplorationState: jest.fn(),
  getNotebookHtmlUrl: jest.fn((id: string) => `/api/v1/sessions/${id}/exploration/notebook`),
  getNotebookDownloadUrl: jest.fn((id: string) => `/api/v1/sessions/${id}/exploration/notebook/download`),
  submitExplorationFeedback: jest.fn(),
}))

const mockedGetState = api.getExplorationState as jest.MockedFunction<typeof api.getExplorationState>
const mockedSubmit = api.submitExplorationFeedback as jest.MockedFunction<typeof api.submitExplorationFeedback>

function makeState(overrides: Partial<{
  open_questions: string[]
  investigation_round: number
  notebook_ready: boolean
  synthesis_constrained: boolean
  synthesis_constraint_reasons: string[]
}> = {}) {
  return {
    exploration_findings: {},
    open_questions: [],
    investigation_round: 0,
    notebook_ready: true,
    synthesis_constrained: false,
    synthesis_constraint_reasons: [],
    ...overrides,
  }
}

describe('ExplorationStage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetState.mockResolvedValue(makeState())
    mockedSubmit.mockResolvedValue({ accepted: true, message: '', investigation_round: 0 })
  })

  it('renders the loading notebook card with brand-primary spinner when notebook_ready is false', async () => {
    mockedGetState.mockResolvedValue(makeState({ notebook_ready: false }))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const spinner = await screen.findByRole('status', { name: /loading/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/Generating exploration notebook/)).toBeInTheDocument()
  })

  it('renders the reinvestigating copy when stage=REINVESTIGATING and notebook not ready', async () => {
    mockedGetState.mockResolvedValue(makeState({ notebook_ready: false }))
    render(<ExplorationStage sessionId="s1" stage="REINVESTIGATING" />)
    expect(await screen.findByText(/Agent is re-investigating your data/)).toBeInTheDocument()
  })

  it('renders the iframe wrapper with the Download link when notebook_ready is true', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Exploration Notebook')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Download \.ipynb/i })
    expect(link).toHaveAttribute('href', '/api/v1/sessions/s1/exploration/notebook/download')
    expect(link.className).toContain('text-fg-muted')
  })

  it('renders the Open Questions card when open_questions has entries', async () => {
    mockedGetState.mockResolvedValue(
      makeState({ open_questions: ['Is co_signer_ssn really optional?', 'Why is state_code constant?'] }),
    )
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Open Questions — Requires Your Input')).toBeInTheDocument()
    expect(screen.getByText(/Is co_signer_ssn/)).toBeInTheDocument()
    expect(screen.getByText(/Why is state_code/)).toBeInTheDocument()
  })

  it('hides the Open Questions card when open_questions is empty', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByText('Open Questions — Requires Your Input')).toBeNull()
  })

  it('renders the Constraint warning when synthesis_constrained is true', async () => {
    mockedGetState.mockResolvedValue(
      makeState({ synthesis_constrained: true, synthesis_constraint_reasons: ['Unresolved Q1', 'Unresolved Q2'] }),
    )
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Constrained Synthesis')).toBeInTheDocument()
    expect(screen.getByText(/Unresolved Q1/)).toBeInTheDocument()
    expect(screen.getByText(/Unresolved Q2/)).toBeInTheDocument()
  })

  it('hides the Constraint warning when synthesis_constrained is false', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByText('Constrained Synthesis')).toBeNull()
  })

  it('renders Round chip with investigation_round + 1', async () => {
    mockedGetState.mockResolvedValue(makeState({ investigation_round: 1 }))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    expect(await screen.findByText('Round 2 of 3')).toBeInTheDocument()
  })

  it('hides feedback section and Re-investigate when maxRoundsReached (investigation_round >= 2); Approve stays', async () => {
    mockedGetState.mockResolvedValue(makeState({ investigation_round: 2 }))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByLabelText(/targeted re-investigation/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Re-investigate/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Approve & Continue/i })).toBeInTheDocument()
    expect(screen.getByText(/Maximum re-investigation rounds reached/)).toBeInTheDocument()
  })

  it('hides feedback and both buttons when readOnly', async () => {
    render(<ExplorationStage sessionId="s1" stage="COMPLETE" readOnly />)
    await screen.findByText('Exploration Notebook')
    expect(screen.queryByLabelText(/targeted re-investigation/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Re-investigate/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Approve & Continue/i })).toBeNull()
  })

  it('disables Re-investigate when feedback is empty, enables when non-empty', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = (await screen.findByRole('button', { name: /Re-investigate/i })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    const textarea = screen.getByPlaceholderText(/Dig deeper into the relationship/)
    fireEvent.change(textarea, { target: { value: 'Look into cosigner clusters' } })
    expect(btn.disabled).toBe(false)
  })

  it('Approve button uses the primary navy class and renders ArrowRight icon', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = await screen.findByRole('button', { name: /Approve & Continue/i })
    expect(btn.className).toContain('bg-brand-accent')
    expect(btn.className).toContain('text-on-brand')
    // lucide icons render as <svg> with lucide-arrow-right class
    expect(btn.querySelector('svg.lucide-arrow-right')).not.toBeNull()
  })

  it('Re-investigate button uses neutral secondary class and renders RefreshCw icon', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = await screen.findByRole('button', { name: /Re-investigate/i })
    expect(btn.className).toContain('bg-surface')
    expect(btn.className).toContain('border-border')
    expect(btn.className).toContain('text-fg-muted')
    expect(btn.querySelector('svg.lucide-refresh-cw')).not.toBeNull()
  })

  it('clicking Approve calls submitExplorationFeedback(sessionId, true)', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    const btn = await screen.findByRole('button', { name: /Approve & Continue/i })
    fireEvent.click(btn)
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledWith('s1', true))
  })

  it('clicking Re-investigate with feedback calls submitExplorationFeedback(sessionId, false, trimmedFeedback)', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    await screen.findByRole('button', { name: /Re-investigate/i })
    const textarea = screen.getByPlaceholderText(/Dig deeper/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '   please dig deeper   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Re-investigate/i }))
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('s1', false, 'please dig deeper'),
    )
  })

  it('after successful Approve, swaps to the submitted state with brand-primary spinner and "Moving to rule proposal…" copy', async () => {
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Continue/i }))
    const spinner = await screen.findByRole('status', { name: /submitting/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(screen.getByText(/Moving to rule proposal/)).toBeInTheDocument()
  })

  it('submitted state uses "Re-investigating…" copy when stage is REINVESTIGATING', async () => {
    render(<ExplorationStage sessionId="s1" stage="REINVESTIGATING" />)
    // notebook is ready in default mock state, so the Approve button still renders
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Continue/i }))
    expect(await screen.findByText(/Re-investigating…/)).toBeInTheDocument()
  })

  it('renders an error banner when submitExplorationFeedback rejects', async () => {
    mockedSubmit.mockRejectedValueOnce(new Error('Network blew up'))
    render(<ExplorationStage sessionId="s1" stage="AWAITING_INVESTIGATION_REVIEW" />)
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Continue/i }))
    const banner = await screen.findByText('Network blew up')
    expect(banner.className).toContain('text-danger-deep')
    expect(banner.className).toContain('bg-danger/15')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/stages/ExplorationStage.test.tsx
```

Expected: FAIL — the current `ExplorationStage` uses legacy tokens (`text-text-primary`, `border-indigo`, `text-warning-light`, etc.), the buttons are styled differently, the loading spinner has no `role="status"`, and the submitted state's spinner uses `border-indigo` rather than `border-brand-primary`. Multiple assertions on class names and accessible roles should fail.

### Task 1.2: Rewrite `ExplorationStage.tsx`

**Files:**
- Modify: `frontend/components/stages/ExplorationStage.tsx` (full rewrite)

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/components/stages/ExplorationStage.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import { ArrowRight, Download, RefreshCw } from 'lucide-react'
import {
  getExplorationState,
  getNotebookHtmlUrl,
  getNotebookDownloadUrl,
  submitExplorationFeedback,
} from '@/lib/api'

interface Props {
  sessionId: string
  stage: string
  readOnly?: boolean
}

interface ExplorationState {
  open_questions: string[]
  investigation_round: number
  notebook_ready: boolean
  synthesis_constrained: boolean
  synthesis_constraint_reasons: string[]
  exploration_findings: Record<string, unknown>
}

export function ExplorationStage({ sessionId, stage, readOnly }: Props) {
  const [state, setState] = useState<ExplorationState | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReinvestigating = stage === 'REINVESTIGATING' || stage === 'PROFILING_SYNTHESIS'

  const load = useCallback(async () => {
    try {
      const s = await getExplorationState(sessionId)
      setState(s)
    } catch {
      // silently retry — notebook may not be ready yet
    }
  }, [sessionId])

  // poll until notebook_ready, then stop. Pre-existing stale-closure quirk
  // preserved verbatim per spec; fixing it is out of scope for Stage 5.
  useEffect(() => {
    load()
    if (state?.notebook_ready) return
    const t = setInterval(() => {
      load()
    }, 3000)
    return () => clearInterval(t)
  }, [load, state?.notebook_ready])

  async function handleApprove() {
    setSubmitting(true)
    setError(null)
    try {
      await submitExplorationFeedback(sessionId, true)
      setSubmitted(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRequestReinvestigation() {
    if (!feedback.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await submitExplorationFeedback(sessionId, false, feedback.trim())
      setSubmitted(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  const maxRoundsReached = (state?.investigation_round ?? 0) >= 2
  const canRequestReinvestigation = !maxRoundsReached && feedback.trim().length > 0
  const notebookReady = !!state?.notebook_ready

  if (submitted) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3">
        <div
          role="status"
          aria-label="Submitting"
          className="w-10 h-10 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"
        />
        <p className="text-sm text-fg-muted">
          {isReinvestigating ? 'Re-investigating…' : 'Moving to rule proposal…'}
        </p>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-fg">Exploration Review</h1>
          <span className="flex-1" />
          {state && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted">
              Round {state.investigation_round + 1} of 3
            </span>
          )}
        </div>
        <p className="text-xs text-fg-muted">
          Review the AI's investigation findings before rules are proposed.
          {maxRoundsReached && ' Maximum re-investigation rounds reached — approve to continue.'}
        </p>
      </div>

      {/* Open Questions card */}
      {state && state.open_questions.length > 0 && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-4 flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-warning-deep">
            Open Questions — Requires Your Input
          </div>
          <ol className="list-decimal list-inside flex flex-col gap-1">
            {state.open_questions.map((q, i) => (
              <li key={i} className="text-xs text-warning-deep leading-relaxed">
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Constraint warning */}
      {state?.synthesis_constrained && (
        <div className="bg-danger/15 border border-danger/30 rounded-xl p-3 flex flex-col gap-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-danger-deep">
            Constrained Synthesis
          </div>
          <p className="text-xs text-danger-deep">
            Rules were proposed despite unresolved uncertainty. The AI summary includes a warning.
          </p>
          {state.synthesis_constraint_reasons.length > 0 && (
            <ul className="list-disc list-inside flex flex-col gap-0.5">
              {state.synthesis_constraint_reasons.map((r, i) => (
                <li key={i} className="text-xs text-danger-deep">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Notebook — loading or ready */}
      {!notebookReady ? (
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Loading"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">
            {isReinvestigating
              ? 'Agent is re-investigating your data…'
              : 'Generating exploration notebook…'}
          </span>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden h-[520px] flex flex-col">
          <div className="flex items-center bg-elevated px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Exploration Notebook
            </span>
            <span className="flex-1" />
            <a
              href={getNotebookDownloadUrl(sessionId)}
              download
              className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted hover:text-fg transition-colors"
            >
              <Download size={12} strokeWidth={2} />
              Download .ipynb
            </a>
          </div>
          <iframe
            src={getNotebookHtmlUrl(sessionId)}
            className="flex-1 bg-white"
            style={{ border: 'none' }}
            title="Exploration Notebook"
          />
        </div>
      )}

      {/* Feedback + actions */}
      {notebookReady && !readOnly && (
        <>
          {!maxRoundsReached && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Request targeted re-investigation (optional)
              </label>
              <textarea
                className="w-full bg-surface border border-border rounded-lg p-2.5 text-xs text-fg resize-none focus:outline-none focus:border-brand-primary placeholder:text-fg-subtle"
                rows={3}
                placeholder={`e.g. "Dig deeper into the relationship between Status and Amount — the cross-column finding seems important"`}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="bg-danger/15 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger-deep">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {!maxRoundsReached && (
              <button
                type="button"
                onClick={handleRequestReinvestigation}
                disabled={!canRequestReinvestigation || submitting}
                className="inline-flex items-center gap-1.5 bg-surface border border-border text-fg-muted text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <RefreshCw size={14} strokeWidth={2} />
                {submitting ? 'Sending…' : 'Re-investigate'}
              </button>
            )}
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? 'Approving…' : 'Approve & Continue'}
              <ArrowRight size={14} strokeWidth={2} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify ExplorationStage tests pass**

```bash
cd frontend && npx jest __tests__/stages/ExplorationStage.test.tsx
```

Expected: 18/18 pass.

- [ ] **Step 3: Full suite + type-check + build**

```bash
cd frontend && npx tsc --noEmit && npx jest && npm run build
```

Expected:
- `tsc`: clean for new/modified files. The pre-existing `.next/types/validator.ts` warning is a stale Next.js artifact from a deleted preview route in an earlier stage — ignore it; `npm run build` regenerates it clean.
- `jest`: pre-existing `__tests__/hooks/useAIStream.test.ts` failure remains the only red. Going-in baseline: 139 passing / 1 failing. After Stage 5: ~157 passing / 1 failing (+18 new ExplorationStage assertions).
- `npm run build`: succeeds.

- [ ] **Step 4: Commit Phase 1**

```bash
git add frontend/components/stages/ExplorationStage.tsx \
        frontend/__tests__/stages/ExplorationStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(explore): rewrite ExplorationStage to token-driven chrome

Replaces the pre-foundation-v1 implementation:
- Heading + subhead retokenized (text-fg / text-fg-muted). Round chip
  uses the neutral elevated-chip pattern (bg-elevated + border + muted
  text + semibold) instead of the legacy bg-surface chip.
- Open Questions card retokenized from bg-warning/10 + text-warning-light
  to the dimension-chip pattern (bg-warning/15 + text-warning-deep) that
  matches Profile stage alerts.
- Constraint warning card retokenized to the danger-deep variant of the
  same pattern.
- Notebook loading state spinner ring is brand-primary (matches Load +
  Profile loading patterns) with role="status" + aria-label="Loading".
- Notebook header uses the established section-label typography
  (text-xs / font-semibold / uppercase / tracking-wider). Download link
  swaps the literal "↓" for the lucide Download icon.
- Textarea retokenized: text-fg, placeholder:text-fg-subtle,
  focus:border-brand-primary.
- Re-investigate button changes from amber-tinted to a neutral outlined
  secondary (bg-surface + border-border + text-fg-muted with a hover
  state that darkens border + text and elevates the bg). Uses the
  lucide RefreshCw icon on the left.
- Approve & Continue picks up the established primary-button class
  (bg-brand-accent + text-on-brand + hover:bg-brand-accent/90 +
  hover:shadow-md + transition-all) with the lucide ArrowRight icon
  on the right.
- Submitted-state spinner ring is brand-primary with role="status" +
  aria-label="Submitting".
- Error banner retokenized to the dimension-chip danger-deep variant.

Behavior preserved verbatim: same Props ({sessionId, stage, readOnly}),
same polling cadence + stale-closure quirk, same submit handlers, same
maxRoundsReached / canRequestReinvestigation gates, same iframe
src/title/border. File shrinks from 218 to ~190 lines.

Tests: 18 new ExplorationStage assertions covering all states
(loading, ready, open questions present/absent, constraint warning
present/absent, max-rounds, readOnly, submitting, submitted under
both stage paths, error). Pre-existing useAIStream red unchanged.
EOF
)"
```

---

## Phase 2 — Preview route

Temporary `/preview/explore` page so the user can review the redesign with mock data before tagging. Same lifecycle pattern as the Profile preview (`b0d360d` → removed at `0018895`). Will be removed in Phase 3.

### Task 2.1: Add the preview route

**Files:**
- Create: `frontend/app/preview/explore/page.tsx`

The page mocks `@/lib/api` at the module-import level isn't viable inside a Next route; instead we render a minimal stub directly by passing pre-resolved state through a wrapper. Since `ExplorationStage` reads state from `getExplorationState` (which hits `/api/v1/sessions/...`), the cleanest approach is to monkey-patch the imports via a small alternate component that mirrors `ExplorationStage`'s behavior but skips the network call. To stay scope-tight, we instead inline a copy of `ExplorationStage`'s render logic in the preview page driven by static mock state. This mirrors the Stage 4 preview pattern (which built its own switcher around the real component).

- [ ] **Step 1: Write the preview page**

```tsx
// frontend/app/preview/explore/page.tsx
'use client'
import { useState } from 'react'
import { ArrowRight, Download, RefreshCw } from 'lucide-react'

type ScenarioKey =
  | 'ready'
  | 'loading'
  | 'reinvestigating'
  | 'constrained'
  | 'max-rounds'
  | 'readonly'

interface MockState {
  open_questions: string[]
  investigation_round: number
  notebook_ready: boolean
  synthesis_constrained: boolean
  synthesis_constraint_reasons: string[]
}

interface Scenario {
  key: ScenarioKey
  label: string
  description: string
  state: MockState
  stage: string
  readOnly?: boolean
}

const READY_QUESTIONS = [
  'Is `co_signer_ssn` truly optional for non-cosigned loans, or is the 41% missingness a data-quality issue?',
  'Why does `state_code` show only one unique value? Verify whether this is a single-state dataset or a column-mapping bug.',
  'The `tenure` column is 100% distinct — is it an identifier rather than a feature?',
]

const SCENARIOS: Scenario[] = [
  {
    key: 'ready',
    label: 'Default (notebook ready, open Q)',
    description: 'Awaiting your approval. 3 open questions, notebook embedded.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: READY_QUESTIONS,
      investigation_round: 0,
      notebook_ready: true,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'loading',
    label: 'Loading (notebook generating)',
    description: 'No state yet — initial poll while the agent generates the notebook.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: [],
      investigation_round: 0,
      notebook_ready: false,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'reinvestigating',
    label: 'Re-investigating',
    description: 'Agent is re-running on the feedback. Different copy on the loader.',
    stage: 'REINVESTIGATING',
    state: {
      open_questions: [],
      investigation_round: 1,
      notebook_ready: false,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'constrained',
    label: 'Constrained synthesis',
    description: 'Notebook ready, synthesis_constrained=true with reasons.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: READY_QUESTIONS.slice(0, 1),
      investigation_round: 1,
      notebook_ready: true,
      synthesis_constrained: true,
      synthesis_constraint_reasons: [
        '`co_signer_ssn` missingness pattern still unresolved after Round 2',
        'Cross-column relationship between Status and Amount needs human review',
      ],
    },
  },
  {
    key: 'max-rounds',
    label: 'Max rounds reached',
    description: 'investigation_round = 2 — feedback hidden, only Approve remains.',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    state: {
      open_questions: READY_QUESTIONS,
      investigation_round: 2,
      notebook_ready: true,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
  {
    key: 'readonly',
    label: 'Read-only (snapshot)',
    description: 'Historic view of a COMPLETE session — no actions, no feedback.',
    stage: 'COMPLETE',
    readOnly: true,
    state: {
      open_questions: READY_QUESTIONS.slice(0, 2),
      investigation_round: 1,
      notebook_ready: true,
      synthesis_constrained: false,
      synthesis_constraint_reasons: [],
    },
  },
]

// Inlined copy of ExplorationStage's render logic — see
// frontend/components/stages/ExplorationStage.tsx. The preview can't
// reuse the real component because it polls the live API; the markup
// is duplicated verbatim here, drive by static mock state.
function PreviewExploration({ scenario }: { scenario: Scenario }) {
  const { state, stage, readOnly } = scenario
  const [feedback, setFeedback] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const isReinvestigating = stage === 'REINVESTIGATING' || stage === 'PROFILING_SYNTHESIS'
  const maxRoundsReached = state.investigation_round >= 2
  const canRequestReinvestigation = !maxRoundsReached && feedback.trim().length > 0
  const notebookReady = state.notebook_ready

  if (submitted) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3">
        <div
          role="status"
          aria-label="Submitting"
          className="w-10 h-10 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"
        />
        <p className="text-sm text-fg-muted">
          {isReinvestigating ? 'Re-investigating…' : 'Moving to rule proposal…'}
        </p>
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-fg">Exploration Review</h1>
          <span className="flex-1" />
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated border border-border text-[11px] font-semibold text-fg-muted">
            Round {state.investigation_round + 1} of 3
          </span>
        </div>
        <p className="text-xs text-fg-muted">
          Review the AI's investigation findings before rules are proposed.
          {maxRoundsReached && ' Maximum re-investigation rounds reached — approve to continue.'}
        </p>
      </div>

      {state.open_questions.length > 0 && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-4 flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-warning-deep">
            Open Questions — Requires Your Input
          </div>
          <ol className="list-decimal list-inside flex flex-col gap-1">
            {state.open_questions.map((q, i) => (
              <li key={i} className="text-xs text-warning-deep leading-relaxed">
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}

      {state.synthesis_constrained && (
        <div className="bg-danger/15 border border-danger/30 rounded-xl p-3 flex flex-col gap-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-danger-deep">
            Constrained Synthesis
          </div>
          <p className="text-xs text-danger-deep">
            Rules were proposed despite unresolved uncertainty. The AI summary includes a warning.
          </p>
          {state.synthesis_constraint_reasons.length > 0 && (
            <ul className="list-disc list-inside flex flex-col gap-0.5">
              {state.synthesis_constraint_reasons.map((r, i) => (
                <li key={i} className="text-xs text-danger-deep">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!notebookReady ? (
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Loading"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">
            {isReinvestigating
              ? 'Agent is re-investigating your data…'
              : 'Generating exploration notebook…'}
          </span>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden h-[520px] flex flex-col">
          <div className="flex items-center bg-elevated px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Exploration Notebook
            </span>
            <span className="flex-1" />
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted hover:text-fg transition-colors"
            >
              <Download size={12} strokeWidth={2} />
              Download .ipynb
            </a>
          </div>
          <div className="flex-1 bg-white p-6 text-[12px] text-fg-muted font-mono leading-relaxed overflow-y-auto">
            <p className="mb-2 text-fg font-semibold"># Exploration Notebook (mock preview)</p>
            <p className="mb-3">
              In live mode this area embeds the rendered Jupyter notebook iframe. The wrapper, border, header, and download link are real — only the iframe body is mocked here.
            </p>
            <p className="mb-1">In [1]: <span className="text-fg">df = read_session(&quot;preview&quot;)</span></p>
            <p className="mb-3">Out[1]: 18,432 rows × 47 columns</p>
            <p className="mb-1">In [2]: <span className="text-fg">df[&apos;co_signer_ssn&apos;].isna().mean()</span></p>
            <p className="mb-3">Out[2]: 0.413  # ~41% missing — investigate optionality</p>
          </div>
        </div>
      )}

      {notebookReady && !readOnly && (
        <>
          {!maxRoundsReached && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Request targeted re-investigation (optional)
              </label>
              <textarea
                className="w-full bg-surface border border-border rounded-lg p-2.5 text-xs text-fg resize-none focus:outline-none focus:border-brand-primary placeholder:text-fg-subtle"
                rows={3}
                placeholder={`e.g. "Dig deeper into the relationship between Status and Amount — the cross-column finding seems important"`}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            {!maxRoundsReached && (
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                disabled={!canRequestReinvestigation}
                className="inline-flex items-center gap-1.5 bg-surface border border-border text-fg-muted text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <RefreshCw size={14} strokeWidth={2} />
                Re-investigate
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubmitted(true)}
              className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
            >
              Approve & Continue
              <ArrowRight size={14} strokeWidth={2} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function ExplorePreviewPage() {
  const [active, setActive] = useState<ScenarioKey>('ready')
  const scenario = SCENARIOS.find((s) => s.key === active) ?? SCENARIOS[0]

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1000px] mx-auto p-6">
        <div className="mb-4 flex flex-col gap-2">
          <h1 className="text-sm font-bold text-fg">Explore stage — preview</h1>
          <p className="text-xs text-fg-muted">
            Temporary preview route for Round 2 / Stage 5 review. Switch scenarios below.
          </p>
          <div className="flex flex-wrap gap-2 mt-1">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
                  active === s.key
                    ? 'bg-brand-accent text-on-brand border-brand-accent'
                    : 'bg-surface text-fg-muted border-border hover:bg-elevated hover:text-fg'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-subtle italic">{scenario.description}</p>
        </div>

        <div className="bg-canvas border border-border rounded-xl overflow-hidden">
          <PreviewExploration scenario={scenario} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build to verify the route compiles**

```bash
cd frontend && npm run build
```

Expected: succeeds. The new `/preview/explore` route appears in the Next build output under `Route (app)`.

- [ ] **Step 3: Commit Phase 2**

```bash
git add frontend/app/preview/explore/page.tsx
git commit -m "$(cat <<'EOF'
chore(preview): add temporary Explore stage preview route

Mounts a mock copy of the redesigned ExplorationStage's render logic
so the populated state can be reviewed without a running backend.

Six scenarios switchable inline at the top of the page:
- Default: notebook ready, 3 open questions, full feedback + actions
- Loading: initial poll, notebook still generating
- Re-investigating: agent re-running with the alternate loader copy
- Constrained synthesis: notebook ready + constraint warning + reasons
- Max rounds reached: feedback hidden, only Approve remains
- Read-only (snapshot): no actions, no feedback (matches SnapshotStageView)

Iframe body is mocked with a small static block so the wrapper, header,
download link, and 520px height can be reviewed without backend.

Same temporary-route pattern as the Profile preview that landed in
b0d360d and was removed in 0018895. Drop this commit after Stage 5
sign-off.
EOF
)"
```

---

## Phase 3 — Verification + cleanup

Manual walkthrough of the preview route, then (optionally) walk a live session, then drop the preview commit and tag.

### Task 3.1: Manual smoke test

- [ ] **Step 1: Start the dev server**

The user typically runs `npm run dev` from their primary checkout (`/Users/anjani.dabkara/Downloads/GitHub/ai-dq-accelerator`) after pulling this branch in. If running it from this worktree:

```bash
cd frontend && npm run dev
```

Then open `http://localhost:3000/preview/explore`.

- [ ] **Step 2: Walk through the six scenarios**

For each scenario button:

1. **Default** — Round chip reads `Round 1 of 3`; Open Questions card renders three amber-tinted entries with the deep amber text; notebook wrapper has the elevated header bar with the `Exploration Notebook` label and `Download .ipynb` link with the lucide download icon; textarea is empty and Re-investigate is disabled; Approve is enabled in the navy primary-button style with the right-arrow icon.

2. **Loading** — Open Questions and Constraint cards hidden; the notebook area renders the `bg-surface` card with a small orange (brand-primary) spinner and the "Generating exploration notebook…" copy; feedback + buttons are hidden (`notebookReady === false` gate).

3. **Re-investigating** — Same as Loading but copy reads "Agent is re-investigating your data…".

4. **Constrained synthesis** — Notebook ready + Open Questions card + Constraint warning card. Verify the constraint card uses the red (`text-danger-deep`) palette and the two `synthesis_constraint_reasons` render as a bulleted list.

5. **Max rounds reached** — Round chip reads `Round 3 of 3`; subhead has the appended "Maximum re-investigation rounds reached — approve to continue." sentence; textarea is hidden; only the Approve button renders.

6. **Read-only** — All three cards (Open Q + notebook) render but the feedback section + both buttons are hidden. Round chip and subhead still render.

- [ ] **Step 3: (Optional) Brand swap**

Append `?client=clayton` to the URL. The Approve button background, scenario-switcher active-button background, and any brand-accent surface should swap to Clayton navy. Brand-primary spinners stay orange (brand-primary is shared) — confirm this matches what Profile preview did.

- [ ] **Step 4: (Optional) Live walkthrough**

If the user has a running stack (`docker compose up -d`), open a real session that's currently in `AWAITING_INVESTIGATION_REVIEW`. Verify the live polling cadence works (3-second interval until `notebook_ready`, then stops), the iframe loads the real notebook, the Download link points at `/api/v1/sessions/{id}/exploration/notebook/download`, and Approve/Re-investigate submit successfully (transition into the centered spinner + correct copy).

- [ ] **Step 5: Pause for user sign-off**

If the user requests Figma-spacing tweaks (Stage 4 pattern, see `12f9e97`), insert a small `fix(explore): mirror Figma spacing tweaks in ExplorationStage` commit here. Otherwise continue to cleanup.

### Task 3.2: Remove the preview route

**Files:**
- Delete: `frontend/app/preview/explore/page.tsx`

- [ ] **Step 1: Delete the preview file**

```bash
git rm frontend/app/preview/explore/page.tsx
```

- [ ] **Step 2: Build to confirm nothing else referenced it**

```bash
cd frontend && npm run build
```

Expected: succeeds. The `/preview/explore` route no longer appears in the build output.

- [ ] **Step 3: Commit Phase 3**

```bash
git commit -m "$(cat <<'EOF'
chore(preview): remove temporary Explore stage preview route

Stage 5 is signed off and the real /sessions/[id] route now exercises
the redesigned Explore stage during AWAITING_INVESTIGATION_REVIEW /
REINVESTIGATING / PROFILING_SYNTHESIS. Mirrors the cleanup done for
the Profile preview in 0018895.
EOF
)"
```

### Task 3.3: Tag `explore-stage-v1`

- [ ] **Step 1: Tag the rewrite commit (not the preview-removal commit)**

The convention from Stages 1–4 is to tag the *last* commit on the stage, which by now is the preview-removal. Match that:

```bash
git tag -a explore-stage-v1 -m "$(cat <<'EOF'
Round 2 Stage 5 — Explore stage redesign

Retokenized ExplorationStage with:
- Dimension-chip Open Questions + Constraint Warning cards
  (bg-{warning,danger}/15 + text-{warning,danger}-deep) matching
  the Stage 4 alert pattern.
- Brand-primary spinner ring on both the notebook-loading state and
  the post-submit centered spinner.
- Re-investigate button as a neutral outlined secondary (bg-surface
  + border-border + text-fg-muted) with the lucide RefreshCw icon —
  Approve is unambiguously the primary path.
- Approve & Continue with the established primary-button class
  (bg-brand-accent + text-on-brand + hover:shadow-md) and the lucide
  ArrowRight icon.
- Notebook header + download link retokenized; literal "↓" replaced
  with the lucide Download icon.
- Round chip in the neutral elevated-chip pattern.

Behavior preserved verbatim: same Props, same polling cadence, same
submit handlers, same maxRoundsReached / readOnly / canRequestReinvestigation
gates.
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Header block — title + Round chip + subhead retokenize | Task 1.2 (Header block) + Task 1.1 (Round chip test) |
| Open Questions card — `bg-warning/15` + `text-warning-deep` | Task 1.2 + Task 1.1 (present/absent assertions) |
| Constraint warning — `bg-danger/15` + `text-danger-deep` + reasons list | Task 1.2 + Task 1.1 (present/absent + reasons assertions) |
| Notebook loading state — brand-primary spinner + role=status | Task 1.2 (loading branch) + Task 1.1 (spinner class + reinvestigating-copy tests) |
| Notebook ready — header bar + Download link with lucide icon | Task 1.2 (ready branch) + Task 1.1 (header text + link href + class assertions) |
| Feedback section — retokenized textarea, focus:brand-primary | Task 1.2 (textarea block) + Task 1.1 (disable/enable test exercises the textarea) |
| Error banner — `bg-danger/15` + `text-danger-deep` | Task 1.2 (error block) + Task 1.1 (rejection-path assertion) |
| Action row — Approve primary + Re-investigate neutral secondary | Task 1.2 (button block) + Task 1.1 (class + icon assertions on both buttons) |
| Submitted state — centered brand-primary spinner + correct copy | Task 1.2 (early-return branch) + Task 1.1 (approve / reinvestigate copy assertions) |
| `maxRoundsReached` gating (feedback + Re-investigate hidden) | Task 1.2 + Task 1.1 |
| `readOnly` gating (feedback + both buttons hidden) | Task 1.2 + Task 1.1 |
| Polling closure preserved verbatim | Task 1.2 — `useEffect` body unchanged from existing component (comment marks it as intentional) |
| Component stays one file (~150 lines) | Task 1.2 — single file rewrite, no helpers extracted |
| Preview route lifecycle (add + remove before tag) | Phase 2 + Phase 3.2 |
| Tag `explore-stage-v1` | Task 3.3 |

**Placeholder scan:** every step has either executable code or an exact command + expected output. No TBDs, no "similar to Task N", no references to undefined symbols. Phase 2's preview page intentionally inlines the markup (rather than wrapping the real component) because `ExplorationStage` polls the live API; the spec acknowledges this is a Stage-4-pattern duplication and the file is dropped in Phase 3.

**Type consistency:**
- `ExplorationStage` props (`{ sessionId: string; stage: string; readOnly?: boolean }`) match what `app/sessions/[id]/page.tsx` and `SnapshotStageView.tsx` already pass — no call-site changes needed.
- `ExplorationState` interface in the rewrite matches the live `getExplorationState` return type from `frontend/lib/api.ts:100-109` field-for-field.
- Preview page's `MockState` interface is structurally identical to the relevant subset of `ExplorationState` (the extra `exploration_findings` map is unused in the render so it's omitted) — keeps the preview tight without drifting from production shape.

**Commit count:** three feature commits (rewrite + preview-add + preview-remove) + a tag. Matches the Stage 4 cadence (Stage 4 had three `feat(profile): …` commits + the same preview lifecycle).

**Pre-existing test failure caveat:** `__tests__/hooks/useAIStream.test.ts` has been failing since before Round 1. Phase 1's "Step 3" verification calls this out explicitly so the implementer doesn't mistake it for a regression. Going-in baseline: 139 passing / 1 failing. After Stage 5: ~157 passing / 1 failing (+18 new ExplorationStage assertions).

**Out-of-scope reminders for the implementer:**
- Do **not** fix the stale-closure quirk in the polling `useEffect` — spec calls it out explicitly. Same `load()` call site, same `state?.notebook_ready` dep, same `clearInterval` cleanup. If it ever becomes a real problem, separate task.
- Do **not** adjust the chip token contrast (`text-warning-deep` on `bg-warning/15` etc.) — borderline WCAG AA, but it's a token-level fix that ripples across every chip in Rules/Sessions/Profile/Explore/AI panel. Queued as the next mini-stage after `explore-stage-v1` ships.
