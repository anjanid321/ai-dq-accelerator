'use client'
import React, { useState } from 'react'
import { Check, ChevronDown, ChevronUp, Circle, SkipForward, X } from 'lucide-react'
import type { SessionState, TransformPlanStep, ExecutionEscalation } from '@/lib/types'
import { resolveEscalation } from '@/lib/api'
import { Chip } from '@/components/ui/Chip'
import { toTitleCase } from '@/lib/text'
import { CodeBlock } from './CodeBlock'

interface Props {
  session: SessionState
  readOnly?: boolean
  demoMode?: boolean
}

type StepStatus = TransformPlanStep['status']

function StatusIcon({ status, applying }: { status: StepStatus; applying: boolean }) {
  if (applying) {
    return (
      <div
        role="status"
        aria-label="Applying"
        className="w-3.5 h-3.5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"
      />
    )
  }
  if (status === 'applied') return <Check size={14} strokeWidth={2.5} className="text-success-deep" />
  if (status === 'skipped') return <SkipForward size={14} strokeWidth={2} className="text-fg-subtle" />
  if (status === 'failed') return <X size={14} strokeWidth={2.5} className="text-danger-deep" />
  return <Circle size={14} strokeWidth={2} className="text-fg-subtle" />
}

function BeforeAfterTables({
  beforeRows,
  afterRows,
  targetColumns,
  affectedRowCount,
}: {
  beforeRows: Record<string, unknown>[]
  afterRows: Record<string, unknown>[]
  targetColumns: string[]
  affectedRowCount?: number | null
}) {
  if (!beforeRows.length && !afterRows.length) return null

  const allKeys = beforeRows.length ? Object.keys(beforeRows[0]) : Object.keys(afterRows[0])

  const detectedChanged = allKeys.filter((col) =>
    beforeRows.some((row, i) => {
      const bv = row[col] === null || row[col] === undefined ? null : String(row[col])
      const av =
        afterRows[i]?.[col] === null || afterRows[i]?.[col] === undefined
          ? null
          : String(afterRows[i]?.[col])
      return bv !== av
    }),
  )

  const targets = [...new Set([...targetColumns.filter((c) => allKeys.includes(c)), ...detectedChanged])]
  const context = allKeys.filter((c) => !targets.includes(c)).slice(0, Math.max(0, 3 - targets.length))
  const keys = [...targets, ...context]
  const rowCount = Math.max(beforeRows.length, afterRows.length)

  function cellVal(row: Record<string, unknown> | undefined, col: string) {
    if (!row) return null
    const v = row[col]
    if (v === null || v === undefined) return null
    return String(v)
  }

  function isChanged(i: number, col: string) {
    return cellVal(beforeRows[i], col) !== cellVal(afterRows[i], col)
  }

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-fg-subtle mb-1">
        Before / After{affectedRowCount != null ? ` · ${affectedRowCount} rows affected` : ''}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-elevated">
              <th className="px-2 py-1 text-left text-fg-subtle font-medium w-10"></th>
              {keys.map((k) => (
                <th
                  key={k}
                  className={`px-2 py-1 text-left font-medium ${
                    targets.includes(k) ? 'text-accent-indigo-deep' : 'text-fg-muted'
                  }`}
                >
                  {k}
                  {targets.includes(k) ? ' ✦' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(rowCount, 5) }).map((_, i) => (
              <React.Fragment key={i}>
                <tr className="border-b border-border/40">
                  <td className="px-2 py-1 text-fg-subtle font-mono">←</td>
                  {keys.map((k) => {
                    const v = cellVal(beforeRows[i], k)
                    const changed = isChanged(i, k)
                    return (
                      <td
                        key={k}
                        className={`px-2 py-1 font-mono truncate max-w-[120px] ${
                          changed && targets.includes(k)
                            ? 'text-danger-deep line-through'
                            : 'text-fg-muted'
                        }`}
                      >
                        {v === null ? <span className="italic text-fg-subtle">null</span> : v}
                      </td>
                    )
                  })}
                </tr>
                <tr
                  className={`${
                    i < Math.min(rowCount, 5) - 1 ? 'border-b border-border' : ''
                  }`}
                >
                  <td className="px-2 py-1 text-fg-subtle font-mono">→</td>
                  {keys.map((k) => {
                    const v = cellVal(afterRows[i], k)
                    const changed = isChanged(i, k)
                    return (
                      <td
                        key={k}
                        className={`px-2 py-1 font-mono truncate max-w-[120px] ${
                          changed && targets.includes(k)
                            ? 'text-success-deep font-semibold'
                            : 'text-fg-muted'
                        }`}
                      >
                        {v === null ? <span className="italic text-fg-subtle">null</span> : v}
                      </td>
                    )
                  })}
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StepRow({ step, isApplying }: { step: TransformPlanStep; isApplying: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail =
    Object.keys(step.params ?? {}).length > 0 ||
    !!step.custom_code ||
    step.targets_rules.length > 0 ||
    !!step.intent ||
    !!step.approach

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div
        className={`flex items-center gap-3 py-2.5 px-3 ${
          hasDetail ? 'cursor-pointer hover:bg-elevated transition-colors' : ''
        }`}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <div className="w-5 h-5 flex items-center justify-center shrink-0">
          <StatusIcon status={step.status} applying={isApplying} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-fg-subtle">{step.id}</span>
            <span className="text-xs font-semibold text-fg">{toTitleCase(step.type)}</span>
            {step.column && (
              <span className="text-xs text-fg-muted font-mono">· {step.column}</span>
            )}
          </div>
          <p className="text-xs text-fg-muted truncate">{step.rationale}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {step.status === 'applied' &&
          step.actual_score_delta !== undefined &&
          step.actual_score_delta !== null ? (
            <>
              <Chip
                variant="score"
                tone={step.actual_score_delta >= 0 ? 'success' : 'danger'}
              >
                {step.actual_score_delta >= 0 ? '+' : ''}
                {(step.actual_score_delta * 100).toFixed(1)}%
              </Chip>
              <span className="text-xs text-fg-subtle hidden md:inline">
                ({(step.projected_score_delta * 100).toFixed(1)}% proj)
              </span>
            </>
          ) : step.status === 'pending' ? (
            <Chip
              variant="score"
              tone={
                step.projected_score_delta > 0
                  ? 'success'
                  : step.projected_score_delta < 0
                    ? 'danger'
                    : 'warning'
              }
            >
              {step.projected_score_delta >= 0 ? '+' : ''}
              {(step.projected_score_delta * 100).toFixed(1)}%
            </Chip>
          ) : null}
        </div>
        <div className="w-5 h-5 flex items-center justify-center shrink-0 text-fg-subtle">
          {hasDetail ? (
            expanded ? (
              <ChevronUp size={14} strokeWidth={2} />
            ) : (
              <ChevronDown size={14} strokeWidth={2} />
            )
          ) : null}
        </div>
      </div>
      {expanded && hasDetail && (
        <div className="mx-3 mt-1.5 mb-3 px-4 py-3 bg-canvas rounded-md border border-border-strong flex flex-col gap-3 text-xs">
          {step.intent && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Intent
              </span>
              <p className="text-fg mt-1 leading-relaxed">{step.intent}</p>
            </div>
          )}
          {step.approach && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Approach
              </span>
              <p className="text-fg mt-1 leading-relaxed">{step.approach}</p>
            </div>
          )}
          {Object.keys(step.params ?? {}).length > 0 && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Params
              </span>
              <pre className="mt-1 text-xs text-fg overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(step.params, null, 2)}
              </pre>
            </div>
          )}
          {step.custom_code && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Custom Code
              </span>
              <div className="mt-1 bg-surface rounded-md overflow-x-auto border border-border">
                <CodeBlock code={step.custom_code} />
              </div>
            </div>
          )}
          {step.targets_rules.length > 0 && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Targets Rules
              </span>
              <p className="font-mono text-fg mt-1">{step.targets_rules.join(', ')}</p>
            </div>
          )}
          {step.before_sample &&
            step.before_sample.length > 0 &&
            step.after_sample &&
            step.after_sample.length > 0 && (
              <BeforeAfterTables
                beforeRows={step.before_sample}
                afterRows={step.after_sample}
                targetColumns={[
                  step.column,
                  step.params?.column as string | undefined,
                  ...((step.params?.columns as string[] | undefined) ?? []),
                  ...(step.target_columns ?? []),
                ].filter((c): c is string => Boolean(c))}
                affectedRowCount={step.affected_row_count}
              />
            )}
        </div>
      )}
    </div>
  )
}

function EscalationOverlay({
  escalation,
  step,
  onResolve,
}: {
  escalation: ExecutionEscalation
  step: TransformPlanStep | undefined
  onResolve: (
    action: string,
    instruction?: string,
    modifiedParams?: Record<string, unknown>,
  ) => Promise<void>
}) {
  const isCustomStep = step?.type === 'custom'
  const originalParams = step?.params ? JSON.stringify(step.params, null, 2) : ''
  const originalCode = step?.custom_code ?? ''

  const [instruction, setInstruction] = useState('')
  const [showChanges, setShowChanges] = useState(false)
  const [paramsText, setParamsText] = useState(originalParams)
  const [codeText, setCodeText] = useState(originalCode)
  const [paramsError, setParamsError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPreApplied = escalation.type === 'regression' || escalation.type === 'divergence'
  const isCodeError = escalation.type === 'code_generation_failed' || escalation.type === 'step_failed'
  const isVerificationFailed = escalation.type === 'transform_verification_failed'

  const paramsChanged = paramsText !== originalParams
  const codeChanged = codeText !== originalCode
  const hasChanges = instruction.trim().length > 0 || paramsChanged || codeChanged

  async function handle(action: string, instr?: string, modParams?: Record<string, unknown>) {
    setSubmitting(true)
    setError(null)
    try {
      await onResolve(action, instr, modParams)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setSubmitting(false)
    }
  }

  function handleRetryWithChanges() {
    let parsedParams: Record<string, unknown> | undefined
    if (paramsChanged && !isCustomStep) {
      try {
        parsedParams = JSON.parse(paramsText)
        setParamsError(null)
      } catch {
        setParamsError('Invalid JSON — fix before retrying')
        return
      }
    }
    const instr = instruction.trim() || undefined
    const modCode = codeChanged && isCustomStep ? codeText : undefined
    const modParams = parsedParams ?? (modCode ? { code: modCode } : undefined)
    handle('provide_instruction', instr, modParams)
  }

  const lastError = escalation.context.last_error as string | undefined
  const projected = escalation.context.projected as number | undefined
  const actual = escalation.context.actual as number | undefined
  const regressedRules = escalation.context.regressed_rule_ids as string[] | undefined
  const beforeSample = Array.isArray(escalation.context.before_sample)
    ? (escalation.context.before_sample as Record<string, unknown>[])
    : null
  const afterSample = Array.isArray(escalation.context.after_sample)
    ? (escalation.context.after_sample as Record<string, unknown>[])
    : null
  const affectedRowCount =
    typeof escalation.context.affected_row_count === 'number'
      ? escalation.context.affected_row_count
      : null

  const baseBtn =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const primaryBtn = `${baseBtn} bg-brand-accent border-brand-accent text-on-brand hover:bg-brand-accent/90`
  const neutralBtn = `${baseBtn} bg-surface border-border-strong text-fg-muted hover:bg-elevated hover:border-fg-muted hover:text-fg`
  const dangerBtn = `${baseBtn} bg-surface border-danger text-danger-deep hover:bg-danger/10`

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 p-4">
      <div className="bg-elevated border border-warning rounded-xl p-5 shadow-xl flex flex-col gap-4 ring-1 ring-warning/40">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Chip variant="status" tone="warning">{toTitleCase(escalation.type)}</Chip>
            <span className="text-xs text-fg-muted font-mono">{escalation.step_id}</span>
          </div>
          <p className="text-sm text-fg">{escalation.description}</p>
        </div>

        {projected !== undefined && actual !== undefined && (
          <div className="text-xs text-fg-muted">
            Expected{' '}
            <span className="text-success-deep font-semibold">
              +{(projected * 100).toFixed(1)}%
            </span>
            {' · '}Got{' '}
            <span
              className={
                actual >= 0
                  ? 'text-warning-deep font-semibold'
                  : 'text-danger-deep font-semibold'
              }
            >
              {actual >= 0 ? '+' : ''}
              {(actual * 100).toFixed(1)}%
            </span>
          </div>
        )}
        {regressedRules && (
          <div className="text-xs text-fg-muted">
            Regressed rules:{' '}
            <span className="font-mono text-danger-deep font-semibold">
              {regressedRules.join(', ')}
            </span>
          </div>
        )}
        {lastError && (
          <pre className="text-xs text-danger-deep bg-danger/10 border border-danger/30 rounded-md p-2 overflow-x-auto">
            {lastError}
          </pre>
        )}

        {isVerificationFailed && beforeSample && afterSample && (
          <BeforeAfterTables
            beforeRows={beforeSample}
            afterRows={afterSample}
            targetColumns={
              step
                ? [step.column, step.params?.column as string | undefined].filter(
                    (c): c is string => Boolean(c),
                  )
                : []
            }
            affectedRowCount={affectedRowCount}
          />
        )}
        {isPreApplied && (
          <p className="text-xs text-fg-muted italic">
            This step has already been applied. You can continue or abort the plan.
          </p>
        )}
        {isCodeError && (
          <p className="text-xs text-fg-muted italic">This step was not applied.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {isPreApplied && (
            <>
              <button onClick={() => handle('continue_anyway')} disabled={submitting} className={primaryBtn}>
                Continue Anyway
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting} className={dangerBtn}>
                Abort Plan
              </button>
            </>
          )}
          {isCodeError && (
            <>
              <button onClick={() => handle('skip_step')} disabled={submitting} className={neutralBtn}>
                Skip Step
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting} className={dangerBtn}>
                Abort Plan
              </button>
            </>
          )}
          {isVerificationFailed && (
            <>
              <button onClick={() => handle('apply_suggestion')} disabled={submitting} className={primaryBtn}>
                Apply Agent Suggestion
              </button>
              <button onClick={() => handle('continue_anyway')} disabled={submitting} className={neutralBtn}>
                Continue Anyway
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting} className={dangerBtn}>
                Abort Plan
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowChanges((v) => !v)}
            disabled={submitting}
            className={neutralBtn}
          >
            Suggest Changes
            {showChanges ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </button>
        </div>

        {showChanges && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                Natural Language Instruction
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Use median instead of zero, handle string columns by casting first..."
                className="mt-1 w-full bg-surface border border-border-strong text-fg rounded-md px-3 py-2 text-xs resize-none h-16 focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
              />
            </div>
            {!isCustomStep && originalParams && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                  Edit Params (JSON)
                </label>
                <textarea
                  value={paramsText}
                  onChange={(e) => {
                    setParamsText(e.target.value)
                    setParamsError(null)
                  }}
                  className="mt-1 w-full bg-surface border border-border-strong text-fg rounded-md px-3 py-2 text-xs font-mono resize-none h-28 focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                />
                {paramsError && (
                  <p className="text-xs text-danger-deep mt-1">{paramsError}</p>
                )}
              </div>
            )}
            {isCustomStep && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                  Edit Custom Code
                </label>
                <textarea
                  value={codeText}
                  onChange={(e) => setCodeText(e.target.value)}
                  className="mt-1 w-full bg-surface border border-border-strong text-fg rounded-md px-3 py-2 text-xs font-mono resize-none h-40 focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleRetryWithChanges}
              disabled={!hasChanges || submitting}
              className={primaryBtn}
            >
              Retry with Changes
            </button>
          </div>
        )}

        {error && <div className="text-xs text-danger-deep">{error}</div>}
      </div>
    </div>
  )
}

export function ExecutionStage({ session, readOnly, demoMode }: Props) {
  const { stage, transform_plan, current_score, baseline_quality_score, execution_escalation } =
    session
  const steps = transform_plan?.steps ?? []

  const isExecuting = stage === 'TRANSFORMATION_LOOP'
  const isEscalated = stage === 'AWAITING_HUMAN_INPUT'

  const applyingStepId = isExecuting ? steps.find((s) => s.status === 'pending')?.id : null

  const scorePct = current_score * 100
  const basePct = baseline_quality_score * 100
  const delta = scorePct - basePct

  async function handleResolve(
    action: string,
    instruction?: string,
    modifiedParams?: Record<string, unknown>,
  ) {
    if (demoMode) {
      await new Promise((r) => setTimeout(r, 400))
      return
    }
    await resolveEscalation(session.session_id, action, instruction, modifiedParams)
  }

  const escalatedStep = execution_escalation
    ? steps.find((s) => s.id === execution_escalation.step_id)
    : undefined

  return (
    <div className="relative flex flex-col h-full">
      <div className="px-5 pt-5 pb-3 flex flex-col gap-3 shrink-0">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-base font-bold text-fg">Transform Execution</h1>
          <p className="text-xs text-fg-muted">
            Applying the approved plan step-by-step. Expand any row for params, code, or before/after samples.
          </p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Quality Score
            </span>
            <span className="text-sm">
              <span className="text-fg font-semibold">{scorePct.toFixed(1)}%</span>
              {delta !== 0 && (
                <span
                  className={`ml-2 text-xs font-semibold ${
                    delta >= 0 ? 'text-success-deep' : 'text-danger-deep'
                  }`}
                >
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(1)}%
                </span>
              )}
              <span className="text-fg-subtle font-normal ml-1.5 text-xs">
                from {basePct.toFixed(1)}%
              </span>
            </span>
          </div>
          <div className="w-full h-1.5 bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-success-deep rounded-full transition-all duration-500"
              style={{ width: `${Math.min(scorePct, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="flex flex-col gap-2">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} isApplying={step.id === applyingStepId} />
          ))}
          {steps.length === 0 && (
            <div className="text-sm text-fg-subtle italic text-center py-12">
              No steps in plan.
            </div>
          )}
        </div>
      </div>

      {isEscalated && execution_escalation && !readOnly && (
        <EscalationOverlay
          escalation={execution_escalation}
          step={escalatedStep}
          onResolve={handleResolve}
        />
      )}
    </div>
  )
}
