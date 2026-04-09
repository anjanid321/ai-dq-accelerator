'use client'
import { useState } from 'react'
import type { SessionState, TransformPlanStep } from '@/lib/types'
import { approvePlan } from '@/lib/api'
import { PlanningStage } from './PlanningStage'

interface Props {
  session: SessionState
}

function ParamEditor({
  params,
  onChange,
}: {
  params: Record<string, unknown>
  onChange: (updated: Record<string, unknown>) => void
}) {
  const isComplex = (v: unknown) => typeof v === 'object' && v !== null

  return (
    <div className="space-y-1 mt-2">
      {Object.entries(params).map(([key, value]) => (
        <div key={key} className="flex items-start gap-2">
          <span className="text-xs text-text-muted/70 font-mono w-24 shrink-0 pt-0.5">{key}</span>
          <input
            type={typeof value === 'number' ? 'number' : 'text'}
            value={isComplex(value) ? JSON.stringify(value) : String(value ?? '')}
            onChange={e => {
              let newVal: unknown = e.target.value
              if (typeof value === 'number') {
                newVal = Number(e.target.value)
              } else if (isComplex(value)) {
                try { newVal = JSON.parse(e.target.value) } catch { newVal = e.target.value }
              }
              onChange({ ...params, [key]: newVal })
            }}
            className="flex-1 bg-surface border border-border rounded px-2 py-0.5 text-xs text-text font-mono focus:outline-none focus:border-indigo/50"
          />
        </div>
      ))}
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-border text-text-muted',
  applied: 'bg-success/20 text-success-light',
  skipped: 'bg-border/50 text-text-muted/50',
  failed: 'bg-red-500/20 text-red-400',
}

function StepCard({
  step,
  index,
  total,
  removedIds,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: TransformPlanStep
  index: number
  total: number
  removedIds: Set<string>
  onUpdate: (updated: TransformPlanStep) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const isCustom = step.type === 'custom'
  const missingDeps = step.depends_on.filter(d => removedIds.has(d))

  return (
    <div className="rounded-lg bg-surface-raised border border-border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full font-mono bg-indigo/20 text-indigo-300">
            {step.type}
          </span>
          <span className="text-sm font-semibold text-text font-mono">{step.id}</span>
          {step.column && <span className="text-xs text-text-muted/70 font-mono">· {step.column}</span>}
          {step.needs_review && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              ⚠ params need review
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="px-1.5 py-0.5 text-xs text-text-muted hover:text-text disabled:opacity-20"
          >↑</button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="px-1.5 py-0.5 text-xs text-text-muted hover:text-text disabled:opacity-20"
          >↓</button>
          <button
            onClick={onRemove}
            className="px-1.5 py-0.5 text-xs text-red-400/60 hover:text-red-400"
          >✕</button>
        </div>
      </div>

      <p className="text-xs text-text-muted leading-relaxed">{step.rationale}</p>

      {isCustom ? (
        <div className="space-y-1">
          {step.intent && <p className="text-xs text-text-muted/80"><span className="font-semibold">Intent:</span> {step.intent}</p>}
          {step.approach && <p className="text-xs text-text-muted/80"><span className="font-semibold">Approach:</span> {step.approach}</p>}
          <div className="text-xs text-text-muted/50 italic">Code generated at execution time.</div>
        </div>
      ) : (
        <ParamEditor
          params={step.params}
          onChange={params => onUpdate({ ...step, params })}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 mt-1">
        {step.targets_rules.map(r => (
          <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-border/50 text-text-muted font-mono">{r}</span>
        ))}
        {step.depends_on.length > 0 && (
          <span className="text-[10px] text-text-muted/50">
            depends on: {step.depends_on.join(', ')}
          </span>
        )}
        <span className="text-xs text-success-light ml-auto">
          +{(step.projected_score_delta * 100).toFixed(1)}%
        </span>
      </div>

      {missingDeps.length > 0 && (
        <div className="text-xs text-amber-400/80">
          ⚠ {missingDeps.join(', ')} was removed — this step may be auto-skipped.
        </div>
      )}
    </div>
  )
}

export function PlanReviewStage({ session }: Props) {
  const { stage, transform_plan, baseline_quality_score } = session

  const [steps, setSteps] = useState<TransformPlanStep[]>(() => transform_plan?.steps ?? [])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (stage === 'PLANNING' || !transform_plan) {
    return <PlanningStage />
  }

  const removedIds = new Set(
    (transform_plan.steps ?? [])
      .filter(s => !steps.find(e => e.id === s.id))
      .map(s => s.id)
  )

  const adjustedProjection = baseline_quality_score + steps.reduce((sum, s) => sum + s.projected_score_delta, 0)

  function updateStep(index: number, updated: TransformPlanStep) {
    setSteps(prev => prev.map((s, i) => i === index ? updated : s))
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    setSteps(prev => {
      const next = [...prev]
      const swap = direction === 'up' ? index - 1 : index + 1
      ;[next[index], next[swap]] = [next[swap], next[index]]
      return next
    })
  }

  async function handleApprove() {
    setSubmitting(true)
    setError(null)
    try {
      await approvePlan(session.session_id, steps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      {/* Summary header */}
      <div className="rounded-xl bg-surface-raised border border-border p-4">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Transform Plan</div>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-text-muted">{transform_plan.steps.length} steps</span>
          <span className="text-text-muted">
            {new Set(transform_plan.steps.flatMap(s => s.targets_rules)).size} rules targeted
          </span>
          <span className="text-text-muted">
            {(baseline_quality_score * 100).toFixed(1)}% → <span className="text-success-light font-semibold">{(transform_plan.projected_final_score * 100).toFixed(1)}%</span> projected
          </span>
        </div>
        {transform_plan.summary && (
          <p className="text-xs text-text-muted/70 mt-2 leading-relaxed">{transform_plan.summary}</p>
        )}
      </div>

      {/* Step cards */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i}
            total={steps.length}
            removedIds={removedIds}
            onUpdate={updated => updateStep(i, updated)}
            onRemove={() => removeStep(i)}
            onMoveUp={() => moveStep(i, 'up')}
            onMoveDown={() => moveStep(i, 'down')}
          />
        ))}
        {steps.length === 0 && (
          <div className="text-sm text-text-muted/50 text-center py-8">All steps removed.</div>
        )}
      </div>

      {/* Sticky approve bar */}
      <div className="sticky bottom-4 pt-2">
        <div className="rounded-xl bg-elevated border border-border p-4 flex items-center justify-between gap-4 shadow-lg">
          <div className="text-sm text-text-muted">
            Adjusted projection: <span className="text-success-light font-semibold">{(adjustedProjection * 100).toFixed(1)}%</span>
            {' '}· {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </div>
          <button
            onClick={handleApprove}
            disabled={steps.length === 0 || submitting}
            className="px-4 py-2 rounded-lg bg-indigo text-white text-sm font-semibold hover:bg-indigo/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Starting...' : 'Approve Plan →'}
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
