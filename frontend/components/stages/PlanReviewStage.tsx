'use client'
import { useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, X } from 'lucide-react'
import type { SessionState, TransformPlanStep } from '@/lib/types'
import { approvePlan } from '@/lib/api'
import { Chip } from '@/components/ui/Chip'
import { toTitleCase } from '@/lib/text'
import { PlanningStage } from './PlanningStage'

interface Props {
  session: SessionState
  readOnly?: boolean
  demoMode?: boolean
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
    <div className="flex flex-col gap-2 mt-1">
      {Object.entries(params).map(([key, value]) => (
        <div key={key} className="flex items-center gap-4">
          <span className="text-xs text-fg-subtle font-mono w-32 shrink-0">{key}</span>
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
            className="flex-1 bg-surface border border-border-strong text-fg rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
          />
        </div>
      ))}
    </div>
  )
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
  readOnly,
}: {
  step: TransformPlanStep
  index: number
  total: number
  removedIds: Set<string>
  onUpdate: (updated: TransformPlanStep) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  readOnly?: boolean
}) {
  const isCustom = step.type === 'custom'
  const missingDeps = step.depends_on.filter(d => removedIds.has(d))

  return (
    <div className="bg-surface rounded-lg border border-border p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Chip variant="status" tone="accent-indigo">{toTitleCase(step.type)}</Chip>
          <span className="text-sm font-semibold text-fg font-mono">{step.id}</span>
          {step.column && (
            <span className="text-xs text-fg-subtle font-mono">· {step.column}</span>
          )}
          {step.needs_review && (
            <Chip variant="status" tone="warning">Params Need Review</Chip>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              aria-label="Move step up"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-muted hover:text-fg hover:bg-elevated transition-colors disabled:opacity-20 disabled:hover:bg-transparent"
            >
              <ArrowUp size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total - 1}
              aria-label="Move step down"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-muted hover:text-fg hover:bg-elevated transition-colors disabled:opacity-20 disabled:hover:bg-transparent"
            >
              <ArrowDown size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove step"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-danger-deep/70 hover:text-danger-deep hover:bg-danger/10 transition-colors"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-fg-muted leading-relaxed">{step.rationale}</p>

      {isCustom ? (
        <div className="flex flex-col gap-1">
          {step.intent && (
            <p className="text-xs text-fg-muted">
              <span className="font-semibold text-fg">Intent:</span> {step.intent}
            </p>
          )}
          {step.approach && (
            <p className="text-xs text-fg-muted">
              <span className="font-semibold text-fg">Approach:</span> {step.approach}
            </p>
          )}
          <div className="text-xs text-fg-subtle italic">Code generated at execution time.</div>
        </div>
      ) : (
        <ParamEditor
          params={step.params}
          onChange={params => onUpdate({ ...step, params })}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 mt-1">
        {step.targets_rules.map(r => (
          <span
            key={r}
            className="text-xs px-1.5 py-0.5 rounded bg-elevated text-fg-muted font-mono"
          >
            {r}
          </span>
        ))}
        {step.depends_on.length > 0 && (
          <span className="text-xs text-fg-subtle">
            depends on: {step.depends_on.join(', ')}
          </span>
        )}
        <Chip
          variant="score"
          tone={
            step.projected_score_delta > 0
              ? 'success'
              : step.projected_score_delta < 0
                ? 'danger'
                : 'warning'
          }
          className="ml-auto"
        >
          {step.projected_score_delta >= 0 ? '+' : ''}
          {(step.projected_score_delta * 100).toFixed(1)}%
        </Chip>
      </div>

      {missingDeps.length > 0 && (
        <div className="text-xs text-warning-deep">
          ⚠ {missingDeps.join(', ')} was removed — this step may be auto-skipped.
        </div>
      )}
    </div>
  )
}

export function PlanReviewStage({ session, readOnly, demoMode }: Props) {
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
      .map(s => s.id),
  )

  const adjustedProjection =
    baseline_quality_score + steps.reduce((sum, s) => sum + s.projected_score_delta, 0)

  function updateStep(index: number, updated: TransformPlanStep) {
    setSteps(prev => prev.map((s, i) => (i === index ? updated : s)))
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
      if (demoMode) {
        await new Promise(r => setTimeout(r, 600))
        return
      }
      await approvePlan(session.session_id, steps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-base font-bold text-fg">Transformation Plan</h1>
          <p className="text-xs text-fg-muted">
            Review the AI-proposed steps. Reorder, edit parameters, or remove steps before approving.
          </p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Plan Summary
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-fg-muted">{transform_plan.steps.length} steps</span>
            <span className="text-fg-muted">
              {new Set(transform_plan.steps.flatMap(s => s.targets_rules)).size} rules targeted
            </span>
            <span className="text-fg-muted">
              {(baseline_quality_score * 100).toFixed(1)}%{' '}
              <ArrowRight size={12} strokeWidth={2} className="inline align-middle text-fg-subtle" />{' '}
              <span className="text-success-deep font-semibold">
                {(transform_plan.projected_final_score * 100).toFixed(1)}%
              </span>{' '}
              projected
            </span>
          </div>
          {transform_plan.summary && (
            <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-lg p-3 flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-widest text-accent-purple-deep">
                ✦ AI SUMMARY
              </div>
              <p className="text-xs text-accent-purple-deep leading-relaxed">
                {transform_plan.summary}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
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
              readOnly={readOnly}
            />
          ))}
          {steps.length === 0 && (
            <div className="text-sm text-fg-subtle italic text-center py-8">
              All steps removed.
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          data-testid="plan-error"
          className="bg-danger/15 border-t border-danger/30 px-6 py-2 text-xs text-danger-deep shrink-0"
        >
          {error}
        </div>
      )}

      {!readOnly && (
        <div
          data-testid="plan-footer"
          className="bg-surface border-t border-border px-6 py-3 flex items-center gap-4 shrink-0"
        >
          <div className="text-sm text-fg-muted">
            Adjusted projection:{' '}
            <span className="text-success-deep font-semibold">
              {(adjustedProjection * 100).toFixed(1)}%
            </span>{' '}
            · {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleApprove}
            disabled={steps.length === 0 || submitting}
            data-testid="approve-plan"
            className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? 'Starting…' : 'Approve Plan'}
            {!submitting && <ArrowRight size={14} strokeWidth={2} />}
          </button>
        </div>
      )}
    </div>
  )
}
