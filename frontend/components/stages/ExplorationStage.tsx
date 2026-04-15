'use client'
import { useState, useEffect, useCallback } from 'react'
import { getExplorationState, getNotebookHtmlUrl, getNotebookDownloadUrl, submitExplorationFeedback } from '@/lib/api'

interface Props {
  sessionId: string
  stage: string
}

interface ExplorationState {
  open_questions: string[]
  investigation_round: number
  notebook_ready: boolean
  synthesis_constrained: boolean
  synthesis_constraint_reasons: string[]
  exploration_findings: Record<string, unknown>
}

export function ExplorationStage({ sessionId, stage }: Props) {
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
    } catch (e) {
      // silently retry — notebook may not be ready yet
    }
  }, [sessionId])

  // poll until notebook_ready, then stop
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

  if (submitted) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3">
        <div className="w-10 h-10 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-text-muted">
          {isReinvestigating ? 'Re-investigating…' : 'Moving to rule proposal…'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-base font-bold text-text-primary">Exploration Review</h1>
          {state && (
            <span className="text-[10px] text-text-muted px-2 py-0.5 rounded bg-surface border border-border">
              Round {state.investigation_round + 1} of 3
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Review the AI's investigation findings before rules are proposed.
          {maxRoundsReached && ' Maximum re-investigation rounds reached — approve to continue.'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Open questions — pinned at top */}
        {state && state.open_questions.length > 0 && (
          <div className="mx-5 mt-4 bg-warning/10 border border-warning/30 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-warning mb-2">Open Questions — Requires Your Input</div>
            <ol className="list-decimal list-inside space-y-1">
              {state.open_questions.map((q, i) => (
                <li key={i} className="text-xs text-warning-light leading-relaxed">{q}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Synthesis constraint warning */}
        {state?.synthesis_constrained && (
          <div className="mx-5 mt-3 bg-danger/10 border border-danger/30 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-danger-light mb-1">Constrained Synthesis</div>
            <p className="text-xs text-danger-light/80">
              Rules were proposed despite unresolved uncertainty. The AI summary includes a warning.
            </p>
            {state.synthesis_constraint_reasons.length > 0 && (
              <ul className="mt-1 list-disc list-inside">
                {state.synthesis_constraint_reasons.map((r, i) => (
                  <li key={i} className="text-xs text-danger-light/70">{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Notebook iframe or loading state */}
        <div className="mx-5 mt-4">
          {isReinvestigating && !state?.notebook_ready ? (
            <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-indigo border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-xs text-text-muted">Agent is re-investigating your data…</span>
            </div>
          ) : !state?.notebook_ready ? (
            <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-indigo border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-xs text-text-muted">Generating exploration notebook…</span>
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden" style={{ height: '520px' }}>
              <div className="flex items-center justify-between bg-elevated px-3 py-2 border-b border-border">
                <span className="text-[10px] uppercase tracking-widest text-text-muted">Exploration Notebook</span>
                <a
                  href={getNotebookDownloadUrl(sessionId)}
                  className="text-[10px] text-indigo-light hover:underline"
                  download
                >
                  Download .ipynb ↓
                </a>
              </div>
              <iframe
                src={getNotebookHtmlUrl(sessionId)}
                className="w-full bg-white"
                style={{ height: 'calc(100% - 33px)', border: 'none' }}
                title="Exploration Notebook"
              />
            </div>
          )}
        </div>

        {/* Feedback + action area */}
        {state?.notebook_ready && (
          <div className="mx-5 mt-4 mb-5">
            {!maxRoundsReached && (
              <div className="mb-3">
                <label className="text-[10px] uppercase tracking-widest text-text-muted block mb-1.5">
                  Request targeted re-investigation (optional)
                </label>
                <textarea
                  className="w-full bg-surface border border-border rounded-lg p-2.5 text-xs text-text-primary resize-none focus:outline-none focus:border-indigo/50 placeholder:text-text-muted"
                  rows={3}
                  placeholder={`e.g. "Dig deeper into the relationship between Status and Amount — the cross-column finding seems important"`}
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                />
              </div>
            )}

            {error && (
              <div className="mb-3 text-xs text-danger-light bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              {!maxRoundsReached && (
                <button
                  className={`text-sm px-4 py-2 rounded-lg border transition-colors ${canRequestReinvestigation ? 'border-warning/40 text-warning-light bg-warning/10 hover:bg-warning/20' : 'border-border text-text-muted opacity-50 cursor-not-allowed'}`}
                  onClick={handleRequestReinvestigation}
                  disabled={!canRequestReinvestigation || submitting}
                >
                  {submitting ? 'Sending…' : 'Re-investigate →'}
                </button>
              )}
              <button
                className="text-sm px-5 py-2 rounded-lg bg-indigo text-white font-medium hover:bg-indigo/90 disabled:opacity-50"
                onClick={handleApprove}
                disabled={submitting}
              >
                {submitting ? 'Approving…' : 'Approve & Continue →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
