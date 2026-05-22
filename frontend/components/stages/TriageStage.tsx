// frontend/components/stages/TriageStage.tsx
'use client'
import { useState } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import type { SessionState, TriageClassification } from '@/lib/types'
import { approveTriage } from '@/lib/api'
import { Chip, type StatusTone } from '@/components/ui/Chip'

interface Props {
  session: SessionState
  readOnly?: boolean
}

type CardDecision = 'accept' | 'keep' | 'pending'
type FilterMode = 'all' | 'needs_decision' | 'fixable' | 'unfixable'

const CLASSIFICATION_TONE: Record<TriageClassification['classification'], StatusTone> = {
  transform_fixable: 'success',
  threshold_too_strict: 'warning',
  unfixable: 'danger',
  eval_error: 'warning',
}

const CLASSIFICATION_LABEL: Record<TriageClassification['classification'], string> = {
  transform_fixable: 'Transform Fixable',
  threshold_too_strict: 'Threshold Too Strict',
  unfixable: 'Unfixable',
  eval_error: 'Eval Error',
}

const CONFIDENCE_COLOR: Record<TriageClassification['confidence'], string> = {
  high: 'text-success-deep',
  medium: 'text-warning-deep',
  low: 'text-fg-muted',
}

const FILTER_LABEL: Record<FilterMode, string> = {
  all: 'All',
  needs_decision: 'Needs Decision',
  fixable: 'Fixable',
  unfixable: 'Unfixable / Error',
}

interface CardProps {
  item: TriageClassification
  decision: CardDecision
  onDecide: (ruleId: string, decision: CardDecision) => void
  readOnly?: boolean
}

function TriageCard({ item, decision, onDecide, readOnly }: CardProps) {
  const needsDecision = item.classification !== 'transform_fixable'

  const chrome =
    !needsDecision || decision === 'pending'
      ? 'border-border'
      : decision === 'accept'
        ? 'border-success ring-1 ring-success/40'
        : 'border-danger ring-1 ring-danger/40'

  const isThreshold = item.classification === 'threshold_too_strict'
  const acceptLabel = isThreshold ? 'Accept Change' : 'Accept Removal'
  const keepLabel = isThreshold ? 'Keep Original' : 'Keep Rule'

  return (
    <div
      data-triage-card={item.rule_id}
      className={`bg-surface border rounded-lg p-4 ${chrome}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="status" tone={CLASSIFICATION_TONE[item.classification]}>
            {CLASSIFICATION_LABEL[item.classification]}
          </Chip>
          <span className="text-sm font-semibold text-fg font-mono">{item.rule_id}</span>
          {item.check && (
            <span className="text-xs text-fg-subtle font-mono">· {item.check}</span>
          )}
          {item.column && (
            <span className="text-xs text-fg-subtle font-mono">· {item.column}</span>
          )}
        </div>
        <span className={`text-xs ${CONFIDENCE_COLOR[item.confidence]}`}>
          confidence: {item.confidence}
        </span>
      </div>

      <p className="text-sm text-fg-muted leading-relaxed mb-3">{item.reason}</p>

      {needsDecision && (
        <>
          {item.classification === 'threshold_too_strict' && item.proposed_threshold !== undefined && (
            <div className="text-xs text-fg-muted mb-2">
              Proposed: raise threshold to{' '}
              <span className="font-semibold text-warning-deep">
                {(item.proposed_threshold * 100).toFixed(2)}%
              </span>
            </div>
          )}
          {(item.classification === 'unfixable' || item.classification === 'eval_error') && item.proposed_remove && (
            <div className="text-xs text-fg-muted mb-2">
              Proposed: <span className="font-semibold text-danger-deep">remove rule</span>
            </div>
          )}
        </>
      )}

      {needsDecision && !readOnly && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDecide(item.rule_id, decision === 'accept' ? 'pending' : 'accept')}
            className={
              decision === 'accept'
                ? 'inline-flex items-center gap-1.5 bg-success-deep border border-success-deep text-on-brand text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors'
                : 'inline-flex items-center gap-1.5 bg-surface border border-success text-success-deep text-[13px] font-semibold px-3 py-1.5 rounded-md hover:bg-success/10 transition-colors'
            }
          >
            <Check size={14} strokeWidth={2} aria-hidden />
            {acceptLabel}
          </button>
          <button
            type="button"
            onClick={() => onDecide(item.rule_id, decision === 'keep' ? 'pending' : 'keep')}
            className={
              decision === 'keep'
                ? 'inline-flex items-center gap-1.5 bg-danger-deep border border-danger-deep text-on-brand text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors'
                : 'inline-flex items-center gap-1.5 bg-surface border border-danger text-danger-deep text-[13px] font-semibold px-3 py-1.5 rounded-md hover:bg-danger/10 transition-colors'
            }
          >
            <X size={14} strokeWidth={2} aria-hidden />
            {keepLabel}
          </button>
        </div>
      )}

      {!needsDecision && !readOnly && (
        <div className="text-xs text-fg-subtle italic">(no decision required)</div>
      )}
    </div>
  )
}

export function TriageStage({ session, readOnly }: Props) {
  const { stage, triage_result } = session

  const [decisions, setDecisions] = useState<Record<string, CardDecision>>(() => {
    const classifications = triage_result?.classifications ?? []
    return Object.fromEntries(
      classifications
        .filter(c => c.classification !== 'transform_fixable')
        .map(c => [c.rule_id, 'pending' as CardDecision]),
    )
  })
  const [filter, setFilter] = useState<FilterMode>('all')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (stage === 'TRIAGING' || !triage_result) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Triaging"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">
            AI is investigating failing rules…
          </span>
        </div>
      </div>
    )
  }

  const { classifications, summary } = triage_result

  const setDecision = (ruleId: string, decision: CardDecision) => {
    setDecisions(prev => ({ ...prev, [ruleId]: decision }))
  }

  const needsDecision = classifications.filter(c => c.classification !== 'transform_fixable')
  const canSubmit = needsDecision.every(c => decisions[c.rule_id] !== 'pending')
  const pendingCount = needsDecision.filter(c => decisions[c.rule_id] === 'pending').length

  const filteredClassifications = classifications.filter(c => {
    if (filter === 'all') return true
    if (filter === 'needs_decision') return c.classification !== 'transform_fixable'
    if (filter === 'fixable') return c.classification === 'transform_fixable'
    if (filter === 'unfixable') return c.classification === 'unfixable' || c.classification === 'eval_error'
    return true
  })

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const acceptedThresholdChanges = classifications
        .filter(c => c.classification === 'threshold_too_strict' && decisions[c.rule_id] === 'accept')
        .map(c => ({ rule_id: c.rule_id, new_threshold: c.proposed_threshold! }))

      const rejectedRuleIds = classifications
        .filter(c => (c.classification === 'unfixable' || c.classification === 'eval_error') && decisions[c.rule_id] === 'accept')
        .map(c => c.rule_id)

      await approveTriage(session.session_id, acceptedThresholdChanges, rejectedRuleIds)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl mx-auto">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Triage Results</h1>
        <p className="text-xs text-fg-muted">
          Review the AI's classification of every failing rule and decide what to do with each.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Triage Summary
        </div>
        <div className="flex flex-wrap gap-4">
          {summary.transform_fixable > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-success shrink-0" />
              <span className="text-fg-muted">{summary.transform_fixable} Transform Fixable</span>
            </span>
          )}
          {summary.threshold_too_strict > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
              <span className="text-fg-muted">{summary.threshold_too_strict} Threshold Too Strict</span>
            </span>
          )}
          {summary.unfixable > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
              <span className="text-fg-muted">{summary.unfixable} Unfixable</span>
            </span>
          )}
          {summary.eval_error > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
              <span className="text-fg-muted">{summary.eval_error} Eval Error</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1.5">
        {(['all', 'needs_decision', 'fixable', 'unfixable'] as FilterMode[]).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? 'inline-flex items-center bg-brand-primary text-on-brand text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors'
                : 'inline-flex items-center bg-surface border border-border text-fg-muted text-[11px] font-semibold px-2.5 py-1 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg transition-colors'
            }
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {filteredClassifications.map(item => (
          <TriageCard
            key={item.rule_id}
            item={item}
            decision={decisions[item.rule_id] ?? 'pending'}
            onDecide={setDecision}
            readOnly={readOnly}
          />
        ))}
      </div>

      {needsDecision.length > 0 && !readOnly && (
        <div className="sticky bottom-4">
          <div className="bg-elevated border border-border rounded-xl p-4 flex items-center justify-between gap-4 shadow-lg">
            <div className="text-sm text-fg-muted">
              {canSubmit ? (
                'All decisions made — ready to proceed.'
              ) : (
                <>
                  <span className="text-warning-deep font-semibold">{pendingCount}</span>{' '}
                  {pendingCount === 1 ? 'rule needs' : 'rules need'} a decision.
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? 'Submitting…' : 'Apply Triage Decisions'}
              {!submitting && <ArrowRight size={14} strokeWidth={2} aria-hidden />}
            </button>
          </div>
          {error && (
            <div className="mt-2 bg-danger/15 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger-deep">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
