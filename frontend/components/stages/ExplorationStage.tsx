// frontend/components/stages/ExplorationStage.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ArrowRight, Download, RefreshCw } from 'lucide-react'
import {
  getExplorationState,
  getNotebookHtmlUrl,
  getNotebookDownloadUrl,
  submitExplorationFeedback,
} from '@/lib/api'
import { Chip } from '@/components/ui/Chip'

export interface ExplorationState {
  open_questions: string[]
  investigation_round: number
  notebook_ready: boolean
  synthesis_constrained: boolean
  synthesis_constraint_reasons: string[]
  exploration_findings: Record<string, unknown>
}

interface Props {
  sessionId: string
  stage: string
  readOnly?: boolean
  // Demo/preview only: when defined, the component renders this state directly
  // and never polls or submits. Used by /demo/explore.
  mockState?: ExplorationState | null
}

export function ExplorationStage({ sessionId, stage, readOnly, mockState }: Props) {
  const isDemo = mockState !== undefined
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
  // Demo mode short-circuits the polling and renders mockState directly.
  useEffect(() => {
    if (isDemo) {
      setState(mockState ?? null)
      return
    }
    load()
    if (state?.notebook_ready) return
    const t = setInterval(() => {
      load()
    }, 3000)
    return () => clearInterval(t)
  }, [isDemo, mockState, load, state?.notebook_ready])

  async function handleApprove() {
    if (isDemo) {
      setSubmitted(true)
      return
    }
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
    if (isDemo) {
      setSubmitted(true)
      return
    }
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
            <Chip variant="neutral">
              Round {state.investigation_round + 1} of 3
            </Chip>
          )}
        </div>
        <p className="text-xs text-fg-muted">
          Review the AI's investigation findings before rules are proposed.
        </p>
      </div>

      {/* Max rounds reached banner */}
      {maxRoundsReached && (
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning-deep">
          <AlertTriangle size={14} strokeWidth={2} />
          Maximum re-investigation rounds reached — approve to continue.
        </div>
      )}

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
              className="inline-flex items-center gap-1.5 bg-surface border border-border text-fg-muted text-xs font-semibold px-2.5 py-1 rounded-md hover:bg-canvas hover:border-fg-muted hover:text-fg transition-all"
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
