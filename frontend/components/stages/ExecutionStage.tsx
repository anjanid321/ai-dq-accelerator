'use client'
import React, { useState } from 'react'
import type { SessionState, TransformPlanStep, ExecutionEscalation } from '@/lib/types'
import { resolveEscalation } from '@/lib/api'
import { CodeBlock } from './CodeBlock'

interface Props {
  session: SessionState
  readOnly?: boolean
}

const STATUS_ICONS: Record<string, string> = {
  applied: '✓',
  skipped: '—',
  failed: '✗',
  pending: '○',
}

const STATUS_COLORS: Record<string, string> = {
  applied: 'text-success-light',
  skipped: 'text-text-muted/40',
  failed: 'text-red-400',
  pending: 'text-text-muted/50',
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

  // Auto-detect columns that actually changed across all sample rows (covers custom code)
  const detectedChanged = allKeys.filter(col =>
    beforeRows.some((row, i) => {
      const bv = row[col] === null || row[col] === undefined ? null : String(row[col])
      const av = afterRows[i]?.[col] === null || afterRows[i]?.[col] === undefined ? null : String(afterRows[i]?.[col])
      return bv !== av
    })
  )

  // Merge explicit targets with auto-detected, preserving order
  const targets = [...new Set([...targetColumns.filter(c => allKeys.includes(c)), ...detectedChanged])]
  // Context: columns not already in targets, up to fill 3 total shown
  const context = allKeys.filter(c => !targets.includes(c)).slice(0, Math.max(0, 3 - targets.length))
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
      <div className="text-[9px] uppercase tracking-wider text-text-muted/50 mb-0.5">
        Before / After{affectedRowCount != null ? ` · ${affectedRowCount} rows affected` : ''}
      </div>
      <div className="overflow-x-auto rounded border border-border/50">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border/30">
              <th className="px-1.5 py-0.5 text-left text-text-muted/40 font-medium w-10"></th>
              {keys.map(k => (
                <th key={k} className={`px-1.5 py-0.5 text-left font-medium ${targets.includes(k) ? 'text-indigo-light/80' : 'text-text-muted/60'}`}>
                  {k}{targets.includes(k) ? ' ✦' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(rowCount, 5) }).map((_, i) => (
              <React.Fragment key={i}>
                <tr className="border-b border-border/10">
                  <td className="px-1.5 py-0.5 text-text-muted/30 font-mono">←</td>
                  {keys.map(k => {
                    const v = cellVal(beforeRows[i], k)
                    const changed = isChanged(i, k)
                    return (
                      <td key={k} className={`px-1.5 py-0.5 font-mono truncate max-w-[120px] ${changed && targets.includes(k) ? 'text-red-400/80 line-through' : 'text-text-muted'}`}>
                        {v === null ? <span className="italic text-text-muted/30">null</span> : v}
                      </td>
                    )
                  })}
                </tr>
                <tr className={`${i < Math.min(rowCount, 5) - 1 ? 'border-b border-border/30' : ''}`}>
                  <td className="px-1.5 py-0.5 text-text-muted/30 font-mono">→</td>
                  {keys.map(k => {
                    const v = cellVal(afterRows[i], k)
                    const changed = isChanged(i, k)
                    return (
                      <td key={k} className={`px-1.5 py-0.5 font-mono truncate max-w-[120px] ${changed && targets.includes(k) ? 'text-success-light font-semibold' : 'text-text-muted'}`}>
                        {v === null ? <span className="italic text-text-muted/30">null</span> : v}
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
  const statusColor = STATUS_COLORS[step.status] ?? 'text-text-muted'
  const hasDetail = Object.keys(step.params ?? {}).length > 0 || step.custom_code || (step.targets_rules?.length > 0) || step.intent || step.approach

  return (
    <div className="rounded-lg hover:bg-black/5">
      <div
        className={`flex items-center gap-3 py-2 px-3 ${hasDetail ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetail && setExpanded(v => !v)}
      >
        <div className={`w-5 text-center font-mono text-sm shrink-0 ${statusColor}`}>
          {isApplying
            ? <span className="inline-block w-3 h-3 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
            : STATUS_ICONS[step.status] ?? '○'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-text-muted/70">{step.id}</span>
            <span className="text-xs font-semibold text-text">{step.type}</span>
            {step.column && <span className="text-xs text-text-muted/60 font-mono">· {step.column}</span>}
            {hasDetail && <span className="text-[10px] text-text-muted/40 ml-auto">{expanded ? '▴' : '▾'}</span>}
          </div>
          <p className="text-xs text-text-muted/60 truncate">{step.rationale}</p>
        </div>
        <div className="text-xs shrink-0 text-right min-w-[60px]">
          {step.status === 'applied' && step.actual_score_delta !== undefined && step.actual_score_delta !== null ? (
            <span className={step.actual_score_delta >= 0 ? 'text-success-light' : 'text-red-400'}>
              {step.actual_score_delta >= 0 ? '+' : ''}{(step.actual_score_delta * 100).toFixed(1)}%
              <span className="text-text-muted/40 ml-1">({(step.projected_score_delta * 100).toFixed(1)}% proj)</span>
            </span>
          ) : step.status === 'pending' ? (
            <span className="text-text-muted/30">{(step.projected_score_delta * 100).toFixed(1)}%</span>
          ) : null}
        </div>
      </div>
      {expanded && hasDetail && (
        <div className="mx-3 mb-2 px-3 py-2.5 bg-surface rounded-lg border border-border space-y-2 text-xs">
          {step.intent && (
            <div><span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Intent</span><p className="text-text-muted mt-0.5">{step.intent}</p></div>
          )}
          {step.approach && (
            <div><span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Approach</span><p className="text-text-muted mt-0.5">{step.approach}</p></div>
          )}
          {Object.keys(step.params ?? {}).length > 0 && (
            <div>
              <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Params</span>
              <pre className="mt-0.5 text-[11px] text-text-muted/80 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(step.params, null, 2)}</pre>
            </div>
          )}
          {step.custom_code && (
            <div>
              <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Custom Code</span>
              <div className="mt-0.5 bg-elevated rounded overflow-x-auto">
                <CodeBlock code={step.custom_code} />
              </div>
            </div>
          )}
          {step.targets_rules?.length > 0 && (
            <div><span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Targets Rules</span><p className="font-mono text-text-muted/80 mt-0.5">{step.targets_rules.join(', ')}</p></div>
          )}
          {step.before_sample && step.before_sample.length > 0 && step.after_sample && step.after_sample.length > 0 && (
            <BeforeAfterTables
              beforeRows={step.before_sample}
              afterRows={step.after_sample}
              targetColumns={[
                step.column,
                step.params?.column as string | undefined,
                ...((step.params?.columns as string[] | undefined) ?? []),
                ...((step.target_columns as string[] | undefined) ?? []),
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
  onResolve: (action: string, instruction?: string, modifiedParams?: Record<string, unknown>) => Promise<void>
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
    // For custom steps, pass code as modified_params.code (convention)
    const modParams = parsedParams ?? (modCode ? { code: modCode } : undefined)
    handle('provide_instruction', instr, modParams)
  }

  const lastError = escalation.context.last_error as string | undefined
  const projected = escalation.context.projected as number | undefined
  const actual = escalation.context.actual as number | undefined
  const regressedRules = escalation.context.regressed_rule_ids as string[] | undefined
  const beforeSample = Array.isArray(escalation.context.before_sample)
    ? escalation.context.before_sample as Record<string, unknown>[]
    : null
  const afterSample = Array.isArray(escalation.context.after_sample)
    ? escalation.context.after_sample as Record<string, unknown>[]
    : null
  const affectedRowCount = typeof escalation.context.affected_row_count === 'number'
    ? escalation.context.affected_row_count
    : null

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 p-4">
      <div className="rounded-xl bg-elevated border border-amber-500/30 p-5 shadow-xl space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-mono">
              {escalation.type}
            </span>
            <span className="text-xs text-text-muted font-mono">{escalation.step_id}</span>
          </div>
          <p className="text-sm text-text">{escalation.description}</p>
        </div>

        {projected !== undefined && actual !== undefined && (
          <div className="text-xs text-text-muted">
            Expected <span className="text-success-light">+{(projected * 100).toFixed(1)}%</span>
            {' '} · Got <span className={actual >= 0 ? 'text-warning' : 'text-red-400'}>{actual >= 0 ? '+' : ''}{(actual * 100).toFixed(1)}%</span>
          </div>
        )}
        {regressedRules && (
          <div className="text-xs text-text-muted">
            Regressed rules: <span className="font-mono text-red-400">{regressedRules.join(', ')}</span>
          </div>
        )}
        {lastError && (
          <pre className="text-xs text-red-400/80 bg-surface rounded p-2 overflow-x-auto">{lastError}</pre>
        )}

        {isVerificationFailed && beforeSample && afterSample && (
          <BeforeAfterTables
            beforeRows={beforeSample}
            afterRows={afterSample}
            targetColumns={step ? [step.column, step.params?.column as string | undefined].filter((c): c is string => Boolean(c)) : []}
            affectedRowCount={affectedRowCount}
          />
        )}
        {isPreApplied && (
          <p className="text-xs text-text-muted/70 italic">This step has already been applied. You can continue or abort the plan.</p>
        )}
        {isCodeError && (
          <p className="text-xs text-text-muted/70 italic">This step was not applied.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {isPreApplied && (
            <>
              <button onClick={() => handle('continue_anyway')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-indigo/20 text-indigo-300 border border-indigo/40 text-xs font-medium hover:bg-indigo/30 disabled:opacity-40">
                Continue Anyway
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 text-xs font-medium hover:bg-red-500/30 disabled:opacity-40">
                Abort Plan
              </button>
            </>
          )}
          {isCodeError && (
            <>
              <button onClick={() => handle('skip_step')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-muted text-xs font-medium hover:border-text-muted/40 disabled:opacity-40">
                Skip Step
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 text-xs font-medium hover:bg-red-500/30 disabled:opacity-40">
                Abort Plan
              </button>
            </>
          )}
          {isVerificationFailed && (
            <>
              <button onClick={() => handle('apply_suggestion')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-indigo/20 text-indigo-300 border border-indigo/40 text-xs font-medium hover:bg-indigo/30 disabled:opacity-40">
                Apply Agent Suggestion
              </button>
              <button onClick={() => handle('continue_anyway')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-muted text-xs font-medium hover:border-text-muted/40 disabled:opacity-40">
                Continue Anyway
              </button>
              <button onClick={() => handle('abort_plan')} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 text-xs font-medium hover:bg-red-500/30 disabled:opacity-40">
                Abort Plan
              </button>
            </>
          )}
          <button onClick={() => setShowChanges(v => !v)} disabled={submitting}
            className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-muted text-xs font-medium hover:border-indigo/40 disabled:opacity-40">
            Suggest Changes {showChanges ? '▴' : '▾'}
          </button>
        </div>

        {showChanges && (
          <div className="space-y-3 border-t border-border/40 pt-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-text-muted/60">Natural Language Instruction</label>
              <textarea
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="e.g. Use median instead of zero, handle string columns by casting first..."
                className="mt-1 w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-text resize-none h-16 focus:outline-none focus:border-indigo/50"
              />
            </div>
            {!isCustomStep && originalParams && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-text-muted/60">Edit Params (JSON)</label>
                <textarea
                  value={paramsText}
                  onChange={e => { setParamsText(e.target.value); setParamsError(null) }}
                  className="mt-1 w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-text font-mono resize-none h-28 focus:outline-none focus:border-indigo/50"
                />
                {paramsError && <p className="text-[10px] text-red-400 mt-0.5">{paramsError}</p>}
              </div>
            )}
            {isCustomStep && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-text-muted/60">Edit Custom Code</label>
                <textarea
                  value={codeText}
                  onChange={e => setCodeText(e.target.value)}
                  className="mt-1 w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-text font-mono resize-none h-40 focus:outline-none focus:border-indigo/50"
                />
              </div>
            )}
            <button
              onClick={handleRetryWithChanges}
              disabled={!hasChanges || submitting}
              className="px-3 py-1.5 rounded-lg bg-indigo/20 text-indigo-300 border border-indigo/40 text-xs font-medium hover:bg-indigo/30 disabled:opacity-40"
            >
              Retry with Changes
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400">{error}</div>
        )}
      </div>
    </div>
  )
}

export function ExecutionStage({ session, readOnly }: Props) {
  const { stage, transform_plan, current_score, baseline_quality_score, execution_escalation } = session
  const steps = transform_plan?.steps ?? []

  const isExecuting = stage === 'TRANSFORMATION_LOOP'
  const isEscalated = stage === 'AWAITING_HUMAN_INPUT'

  // The first pending step is "applying" during active execution
  const applyingStepId = isExecuting
    ? steps.find(s => s.status === 'pending')?.id
    : null

  const scorePct = current_score * 100
  const basePct = baseline_quality_score * 100
  const delta = scorePct - basePct

  async function handleResolve(action: string, instruction?: string, modifiedParams?: Record<string, unknown>) {
    await resolveEscalation(session.session_id, action, instruction, modifiedParams)
  }

  const escalatedStep = execution_escalation
    ? steps.find(s => s.id === execution_escalation.step_id)
    : undefined

  return (
    <div className="relative flex flex-col h-full">
      {/* Score bar */}
      <div className="px-6 pt-5 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted uppercase tracking-wider font-semibold">Transform Progress</span>
          <span className="text-sm font-semibold">
            <span className="text-text">{scorePct.toFixed(1)}%</span>
            {delta !== 0 && (
              <span className={`ml-2 text-xs ${delta >= 0 ? 'text-success-light' : 'text-red-400'}`}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
        <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo to-success rounded-full transition-all duration-500"
            style={{ width: `${Math.min(scorePct, 100)}%` }}
          />
        </div>
      </div>

      {/* Step list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-0.5">
          {steps.map(step => (
            <StepRow
              key={step.id}
              step={step}
              isApplying={step.id === applyingStepId}
            />
          ))}
          {steps.length === 0 && (
            <div className="text-sm text-text-muted/50 text-center py-12">No steps in plan.</div>
          )}
        </div>
      </div>

      {/* Escalation overlay */}
      {isEscalated && execution_escalation && !readOnly && (
        <EscalationOverlay escalation={execution_escalation} step={escalatedStep} onResolve={handleResolve} />
      )}
    </div>
  )
}
