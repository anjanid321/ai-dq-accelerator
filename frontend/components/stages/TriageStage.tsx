'use client'
import { useState } from 'react'
import type { SessionState, TriageClassification } from '@/lib/types'
import { approveTriage } from '@/lib/api'

interface Props {
  session: SessionState
}

type CardDecision = 'accept' | 'keep' | 'pending'
type FilterMode = 'all' | 'needs_decision' | 'fixable' | 'unfixable'

const CLASSIFICATION_LABELS: Record<string, string> = {
  transform_fixable: 'transform_fixable',
  threshold_too_strict: 'threshold_too_strict',
  unfixable: 'unfixable',
  eval_error: 'eval_error',
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  transform_fixable: 'bg-success/20 text-success-light',
  threshold_too_strict: 'bg-warning/20 text-warning',
  unfixable: 'bg-red-500/20 text-red-400',
  eval_error: 'bg-amber-500/20 text-amber-400',
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-success-light',
  medium: 'text-warning',
  low: 'text-text-muted',
}

function ClassificationBadge({ classification }: { classification: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full font-mono ${CLASSIFICATION_COLORS[classification] ?? 'bg-border text-text-muted'}`}>
      {CLASSIFICATION_LABELS[classification] ?? classification}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <span className={`text-xs ${CONFIDENCE_COLORS[confidence] ?? 'text-text-muted'}`}>
      confidence: {confidence}
    </span>
  )
}

interface CardProps {
  item: TriageClassification
  decision: CardDecision
  onDecide: (ruleId: string, decision: CardDecision) => void
}

function TriageCard({ item, decision, onDecide }: CardProps) {
  const needsDecision = item.classification !== 'transform_fixable'

  const borderColor = {
    transform_fixable: 'border-l-success/60',
    threshold_too_strict: 'border-l-warning/60',
    unfixable: 'border-l-red-500/60',
    eval_error: 'border-l-amber-500/60',
  }[item.classification] ?? 'border-l-border'

  return (
    <div className={`rounded-lg bg-surface-raised border border-border p-4 border-l-2 ${borderColor}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <ClassificationBadge classification={item.classification} />
          <span className="text-sm font-semibold text-text font-mono">{item.rule_id}</span>
          {item.check && <span className="text-xs text-text-muted/70 font-mono">· {item.check}</span>}
          {item.column && <span className="text-xs text-text-muted/70 font-mono">· {item.column}</span>}
        </div>
        <ConfidenceBadge confidence={item.confidence} />
      </div>

      <p className="text-sm text-text-muted leading-relaxed mb-3">{item.reason}</p>

      {needsDecision && (
        <div className="space-y-2">
          {item.classification === 'threshold_too_strict' && item.proposed_threshold !== undefined && (
            <div className="text-xs text-text-muted/80 mb-2">
              Proposed: raise threshold to <span className="font-semibold text-warning">{(item.proposed_threshold * 100).toFixed(2)}%</span>
            </div>
          )}
          {(item.classification === 'unfixable' || item.classification === 'eval_error') && item.proposed_remove && (
            <div className="text-xs text-text-muted/80 mb-2">
              Proposed: <span className="font-semibold text-red-400">remove rule</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onDecide(item.rule_id, decision === 'accept' ? 'pending' : 'accept')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                decision === 'accept'
                  ? 'bg-success/20 text-success border border-success/40'
                  : 'bg-surface border border-border text-text-muted hover:border-success/40 hover:text-success'
              }`}
            >
              <span>✓</span>
              {item.classification === 'threshold_too_strict' ? 'Accept Change' : 'Accept Removal'}
            </button>
            <button
              onClick={() => onDecide(item.rule_id, decision === 'keep' ? 'pending' : 'keep')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                decision === 'keep'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'bg-surface border border-border text-text-muted hover:border-red-500/40 hover:text-red-400'
              }`}
            >
              <span>✗</span>
              {item.classification === 'threshold_too_strict' ? 'Keep Original' : 'Keep Rule'}
            </button>
          </div>
        </div>
      )}

      {!needsDecision && (
        <div className="text-xs text-text-muted/50 italic">(no decision required)</div>
      )}
    </div>
  )
}

export function TriageStage({ session }: Props) {
  const { stage, triage_result } = session

  const [decisions, setDecisions] = useState<Record<string, CardDecision>>(() => {
    const classifications = triage_result?.classifications ?? []
    return Object.fromEntries(
      classifications
        .filter(c => c.classification !== 'transform_fixable')
        .map(c => [c.rule_id, 'pending' as CardDecision])
    )
  })
  const [filter, setFilter] = useState<FilterMode>('all')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (stage === 'TRIAGING' || !triage_result) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted p-8">
        <div className="w-8 h-8 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
        <div className="text-sm text-center">AI is investigating failing rules...</div>
        <div className="text-xs text-text-muted/60 text-center">The AI panel on the right shows live progress.</div>
      </div>
    )
  }

  const { classifications, summary } = triage_result

  const setDecision = (ruleId: string, decision: CardDecision) => {
    setDecisions(prev => ({ ...prev, [ruleId]: decision }))
  }

  const needsDecision = classifications.filter(c => c.classification !== 'transform_fixable')
  const canSubmit = needsDecision.every(c => decisions[c.rule_id] !== 'pending')

  const filteredClassifications = classifications.filter(c => {
    if (filter === 'all') return true
    if (filter === 'needs_decision') return c.classification !== 'transform_fixable'
    if (filter === 'fixable') return c.classification === 'transform_fixable'
    if (filter === 'unfixable') return c.classification === 'unfixable' || c.classification === 'eval_error'
    return true
  })

  const pendingCount = needsDecision.filter(c => decisions[c.rule_id] === 'pending').length

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const acceptedThresholdChanges = classifications
        .filter(c => c.classification === 'threshold_too_strict' && decisions[c.rule_id] === 'accept')
        .map(c => ({ rule_id: c.rule_id, new_threshold: c.proposed_threshold! }))

      const rejectedRuleIds = classifications
        .filter(c => ['unfixable', 'eval_error'].includes(c.classification) && decisions[c.rule_id] === 'accept')
        .map(c => c.rule_id)

      await approveTriage(session.session_id, acceptedThresholdChanges, rejectedRuleIds)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      {/* Summary row */}
      <div className="rounded-xl bg-surface-raised border border-border p-4">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Triage Summary</div>
        <div className="flex flex-wrap gap-3">
          {summary.transform_fixable > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-success/60 shrink-0" />
              <span className="text-text-muted">{summary.transform_fixable} transform-fixable</span>
            </span>
          )}
          {summary.threshold_too_strict > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-warning/60 shrink-0" />
              <span className="text-text-muted">{summary.threshold_too_strict} threshold-too-strict</span>
            </span>
          )}
          {summary.unfixable > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-red-500/60 shrink-0" />
              <span className="text-text-muted">{summary.unfixable} unfixable</span>
            </span>
          )}
          {summary.eval_error > 0 && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2 h-2 rounded-full bg-amber-500/60 shrink-0" />
              <span className="text-text-muted">{summary.eval_error} eval-error</span>
            </span>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {(['all', 'needs_decision', 'fixable', 'unfixable'] as FilterMode[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-indigo/20 text-indigo-300 border border-indigo/40'
                : 'bg-surface border border-border text-text-muted hover:border-indigo/30'
            }`}
          >
            {f === 'all' ? 'All' : f === 'needs_decision' ? 'Needs Decision' : f === 'fixable' ? 'Fixable' : 'Unfixable/Error'}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {filteredClassifications.map(item => (
          <TriageCard
            key={item.rule_id}
            item={item}
            decision={decisions[item.rule_id] ?? 'pending'}
            onDecide={setDecision}
          />
        ))}
      </div>

      {/* Submit */}
      {needsDecision.length > 0 && (
        <div className="sticky bottom-4 pt-2">
          <div className="rounded-xl bg-elevated border border-border p-4 flex items-center justify-between gap-4 shadow-lg">
            <div className="text-sm text-text-muted">
              {canSubmit
                ? 'All decisions made — ready to proceed.'
                : <><span className="text-warning font-semibold">{pendingCount}</span> {pendingCount === 1 ? 'rule needs' : 'rules need'} a decision.</>
              }
            </div>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="px-4 py-2 rounded-lg bg-indigo text-white text-sm font-semibold hover:bg-indigo/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Submitting...' : 'Apply Triage Decisions →'}
            </button>
          </div>
          {error && (
            <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
