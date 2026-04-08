'use client'
import { useState } from 'react'
import type { SessionState, TransformPlanStep, ExecutionEscalation } from '@/lib/types'
import { resolveEscalation } from '@/lib/api'
import { CodeBlock } from './CodeBlock'

interface Props {
  session: SessionState
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

function SampleTable({ label, rows }: { label: string; rows: Record<string, unknown>[] }) {
  if (!rows.length) return null
  const keys = Object.keys(rows[0]).slice(0, 3)
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-text-muted/50 mb-0.5">{label}</div>
      <div className="overflow-x-auto rounded border border-border/50">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border/30">
              {keys.map(k => <th key={k} className="px-1.5 py-0.5 text-left text-text-muted/60 font-medium">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row, i) => (
              <tr key={i} className="border-b border-border/20 last:border-0">
                {keys.map(k => (
                  <td key={k} className="px-1.5 py-0.5 font-mono text-text-muted truncate max-w-[100px]">
                    {row[k] === null || row[k] === undefined
                      ? <span className="italic text-text-muted/40">null</span>
                      : String(row[k])}
                  </td>
                ))}
              </tr>
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
    <div className="rounded-lg hover:bg-white/3">
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
            <div>
              <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">
                Before / After{step.affected_row_count != null ? ` · ${step.affected_row_count} rows affected` : ''}
              </span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <SampleTable label="Before" rows={step.before_sample} />
                <SampleTable label="After" rows={step.after_sample} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EscalationOverlay({
  escalation,
  onResolve,
}: {
  escalation: ExecutionEscalation
  onResolve: (action: string, instruction?: string) => Promise<void>
}) {
  const [instruction, setInstruction] = useState('')
  const [showInstruction, setShowInstruction] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPreApplied = escalation.type === 'regression' || escalation.type === 'divergence'
  const isCodeError = escalation.type === 'code_generation_failed' || escalation.type === 'step_failed'
  const isVerificationFailed = escalation.type === 'transform_verification_failed'

  async function handle(action: string, instr?: string) {
    setSubmitting(true)
    setError(null)
    try {
      await onResolve(action, instr)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setSubmitting(false)
    }
  }

  const lastError = escalation.context.last_error as string | undefined
  const projected = escalation.context.projected as number | undefined
  const actual = escalation.context.actual as number | undefined
  const regressedRules = escalation.context.regressed_rule_ids as string[] | undefined

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

        {isVerificationFailed && escalation.context.before_sample && escalation.context.after_sample && (
          <div className="grid grid-cols-2 gap-2">
            <SampleTable label="Before" rows={escalation.context.before_sample as Record<string, unknown>[]} />
            <SampleTable label="After" rows={escalation.context.after_sample as Record<string, unknown>[]} />
          </div>
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
              <button onClick={() => setShowInstruction(v => !v)} disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-text-muted text-xs font-medium hover:border-indigo/40 disabled:opacity-40">
                Provide Guidance ▾
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
        </div>

        {showInstruction && isCodeError && (
          <div className="space-y-2">
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder="e.g. Use median instead of zero, handle string columns by casting first..."
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-text resize-none h-20 focus:outline-none focus:border-indigo/50"
            />
            <button
              onClick={() => handle('provide_instruction', instruction)}
              disabled={!instruction.trim() || submitting}
              className="px-3 py-1.5 rounded-lg bg-indigo/20 text-indigo-300 border border-indigo/40 text-xs font-medium hover:bg-indigo/30 disabled:opacity-40"
            >
              Retry with Instruction
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

export function ExecutionStage({ session }: Props) {
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

  async function handleResolve(action: string, instruction?: string) {
    await resolveEscalation(session.session_id, action, instruction)
  }

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
      {isEscalated && execution_escalation && (
        <EscalationOverlay escalation={execution_escalation} onResolve={handleResolve} />
      )}
    </div>
  )
}
