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

const CONFIDENCE_TONE: Record<TriageClassification['confidence'], StatusTone> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
}

const CONFIDENCE_LABEL: Record<TriageClassification['confidence'], string> = {
  high: 'High Confidence',
  medium: 'Medium Confidence',
  low: 'Low Confidence',
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
      className={`bg-surface border rounded-lg p-4 flex flex-col gap-2 ${chrome}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
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
        <Chip
          variant="status"
          tone={CONFIDENCE_TONE[item.confidence]}
          className="shrink-0"
        >
          {CONFIDENCE_LABEL[item.confidence]}
        </Chip>
      </div>

      <p className="text-sm text-fg-muted leading-relaxed">{item.reason}</p>

      {needsDecision && (
        <>
          {item.classification === 'threshold_too_strict' && item.proposed_threshold !== undefined && (
            <div className="text-xs text-fg-muted">
              Proposed: raise threshold to{' '}
              <span className="font-semibold text-warning-deep">
                {(item.proposed_threshold * 100).toFixed(2)}%
              </span>
            </div>
          )}
          {(item.classification === 'unfixable' || item.classification === 'eval_error') && item.proposed_remove && (
            <div className="text-xs text-fg-muted">
              Proposed: <span className="font-semibold text-danger-deep">remove rule</span>
            </div>
          )}
        </>
      )}

      {!needsDecision && !readOnly && (
        <div className="text-xs text-fg-subtle italic">(no decision required)</div>
      )}

      {needsDecision && !readOnly && (
        <div className="flex justify-end gap-2">
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
      <div className="p-5">
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
  const acceptedCount = needsDecision.filter(c => decisions[c.rule_id] === 'accept').length
  const keptCount = needsDecision.filter(c => decisions[c.rule_id] === 'keep').length
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
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
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

        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'needs_decision', 'fixable', 'unfixable'] as FilterMode[]).map(f => {
            const isActive = filter === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                data-filter={f}
                data-active={isActive}
                className={[
                  'text-xs px-2.5 py-1 rounded-md border bg-surface transition-colors',
                  isActive
                    ? 'border-brand-primary text-fg font-semibold hover:bg-brand-primary/5'
                    : 'border-border-strong text-fg-muted hover:bg-elevated hover:border-fg-muted hover:text-fg',
                ].join(' ')}
              >
                {FILTER_LABEL[f]}
              </button>
            )
          })}
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
      </div>

      {error && (
        <div
          data-testid="triage-error"
          className="bg-danger/15 border-t border-danger/30 px-6 py-2 text-xs text-danger-deep shrink-0"
        >
          {error}
        </div>
      )}

      {needsDecision.length > 0 && !readOnly && (
        <div
          data-testid="triage-footer"
          className="bg-surface border-t border-border px-6 py-3 flex items-center gap-4 shrink-0"
        >
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[12px] font-medium text-success-deep">{acceptedCount} Accepted</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-danger" />
              <span className="text-[12px] font-medium text-danger-deep">{keptCount} Kept</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-border-strong" />
              <span className="text-[12px] font-medium text-fg-muted">{pendingCount} Pending</span>
            </span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            data-testid="apply-triage-decisions"
            className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? 'Submitting…' : 'Apply Triage Decisions'}
            {!submitting && <ArrowRight size={14} strokeWidth={2} aria-hidden />}
          </button>
        </div>
      )}
    </div>
  )
}
