'use client'
import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { SessionState, TransformationLogEntry } from '@/lib/types'
import { decideTransformation } from '@/lib/api'

function CodeBlock({ code }: { code: string }) {
  return (
    <SyntaxHighlighter
      language="python"
      style={vscDarkPlus}
      customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '11px', padding: '10px' }}
    >
      {code}
    </SyntaxHighlighter>
  )
}

function CollapsibleCode({ code }: { code: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-elevated text-[10px] text-text-muted hover:text-text transition-colors"
      >
        <span className="font-mono uppercase tracking-wider">Custom Code</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && <CodeBlock code={code} />}
    </div>
  )
}

interface Props { session: SessionState }

export function TransformStage({ session }: Props) {
  const [acting, setActing] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)

  const suggestion = session.current_suggestion
  const log: TransformationLogEntry[] = session.transformation_log
  const baseline = Math.round(session.baseline_quality_score * 100)
  const current = Math.round(session.current_score * 100)
  const delta = current - baseline

  // Show spinner when we've submitted a decision but the same suggestion is still in state
  const isWaiting = pendingId !== null && pendingId === suggestion?.transformation_id

  async function decide(approved: boolean) {
    if (!suggestion) return
    setActing(true)
    try {
      await decideTransformation(session.session_id, suggestion.transformation_id, approved)
      setPendingId(suggestion.transformation_id)
    } finally {
      setActing(false)
    }
  }

  const preview = suggestion?.preview
  const projDelta = preview?.projected_score_delta ? Math.round(preview.projected_score_delta * 100) : null
  const projScore = preview?.projected_score ? Math.round(preview.projected_score * 100) : null
  const n = log.length + 1

  return (
    <div className="p-5">
      <h1 className="text-base font-bold text-text-primary mb-1">Transformations</h1>
      <p className="text-xs text-text-muted mb-4">Review each AI-suggested fix. Accept to apply, reject or skip to move on.</p>

      {/* Score tracker */}
      <div className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-5 mb-4">
        <div className="text-center shrink-0">
          <div className="text-2xl font-bold text-text-muted">{baseline}%</div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">Baseline</div>
        </div>
        <div className="text-text-muted text-lg">→</div>
        <div className="text-center shrink-0">
          <div className="text-2xl font-bold text-success-light">{current}%</div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">Current</div>
        </div>
        <div className="flex-1">
          <div className="flex justify-between text-[10px] text-text-muted mb-1">
            <span>Quality Score</span>
            {delta > 0 && <span className="text-success-light">+{delta}% so far</span>}
          </div>
          <div className="bg-border rounded-full h-2 relative overflow-hidden">
            <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${current}%`, background: 'linear-gradient(90deg,#6366f1,#22c55e)' }} />
            <div className="absolute top-0 bottom-0 w-0.5 bg-text-muted z-10" style={{ left: `${baseline}%` }} />
          </div>
        </div>
      </div>

      {/* Suggestion card / waiting spinner */}
      {isWaiting || !suggestion ? (
        <div className="bg-surface border border-border rounded-xl p-8 mb-4 flex flex-col items-center justify-center gap-3 text-text-muted">
          <div className="w-6 h-6 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
          <div className="text-sm font-medium">
            {isWaiting ? 'Processing your decision...' : 'AI is generating the next suggestion...'}
          </div>
          <div className="text-xs">Waiting for the next suggestion.</div>
        </div>
      ) : (
        <div className="bg-surface border border-indigo/40 rounded-xl p-4 mb-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo/20 text-indigo-light font-mono">{suggestion.type}</span>
                <span className="text-[10px] text-text-muted">suggestion {n} of ?</span>
              </div>
              <h2 className="text-sm font-bold text-text-primary font-mono">
                {suggestion.type.replace(/_/g, ' ')}{suggestion.params.column ? ` · ${suggestion.params.column}` : ''}
              </h2>
            </div>
            {projDelta != null && (
              <div className="bg-indigo/10 border border-indigo/30 rounded-lg px-3 py-2 text-center shrink-0">
                <div className="text-base font-bold text-indigo-light">+{projDelta}%</div>
                <div className="text-[9px] text-text-muted">projected</div>
              </div>
            )}
          </div>

          <p className="text-xs text-text-secondary mb-3 leading-relaxed">{suggestion.rationale}</p>

          {/* Technical Implementation */}
          <div className="mt-3 rounded-lg bg-elevated border border-border p-3 mb-4">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Technical Implementation</div>
            <div className="font-mono text-xs space-y-1">
              {Object.entries(suggestion.params)
                .filter(([k]) => k !== 'code')
                .map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-text-muted/70">{k}:</span>
                    <span className="text-indigo-light">{String(v)}</span>
                  </div>
                ))}
            </div>
            {suggestion.custom_code && (
              <CollapsibleCode code={suggestion.custom_code} />
            )}
          </div>

          {/* Impact chips */}
          {preview && (
            <div className="flex gap-2 mb-4">
              {[
                { label: 'Rows affected', value: preview.affected_row_count.toLocaleString() },
                { label: 'Score delta', value: projDelta != null ? `+${projDelta}%` : '—', color: 'text-success-light' },
                { label: 'Projected', value: projScore != null ? `${projScore}%` : '—', color: 'text-success-light' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex-1 bg-elevated border border-border rounded-lg py-2 text-center">
                  <div className={`text-sm font-bold ${color ?? 'text-text-primary'}`}>{value}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Before/After preview */}
          {preview && preview.before_sample.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Before / After Preview</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Before', rows: preview.before_sample, isAfter: false },
                  { label: 'After', rows: preview.after_sample, isAfter: true },
                ].map(({ label, rows, isAfter }) => {
                  const cols = Object.keys(rows[0] ?? {})
                  return (
                    <div key={label} className={`rounded-lg overflow-hidden border ${isAfter ? 'border-success/30' : 'border-border'}`}>
                      <div className={`px-2.5 py-1.5 text-[10px] font-semibold border-b ${isAfter ? 'text-success-light bg-success/5 border-success/20' : 'text-text-muted bg-elevated border-border'}`}>{label}</div>
                      <div className="overflow-x-auto">
                      <table className="text-[10px] font-mono min-w-full">
                        <thead><tr>{cols.map(c => <th key={c} className="px-2 py-1 text-left text-text-muted border-b border-border font-normal">{c}</th>)}</tr></thead>
                        <tbody>
                          {rows.slice(0, 4).map((row, ri) => {
                            const before = preview.before_sample[ri]
                            return (
                              <tr key={ri} className="border-b border-surface last:border-0">
                                {cols.map(c => {
                                  const val = row[c]
                                  const changed = isAfter && before && before[c] !== val
                                  const isNull = val === null
                                  return (
                                    <td key={c} className={`px-2 py-1.5 ${changed ? 'text-success-light bg-success/5' : isNull ? 'text-danger-light italic' : 'text-text-muted'}`}>
                                      {val === null ? 'NULL' : String(val)}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Decision bar */}
          <div className="flex gap-2">
            <button className="flex-1 bg-success text-black font-semibold text-sm py-2.5 rounded-lg disabled:opacity-40" disabled={acting} onClick={() => decide(true)}>
              ✓ Accept Transform
            </button>
            <button className="flex-1 bg-danger/20 text-danger-light border border-danger/40 text-sm py-2.5 rounded-lg disabled:opacity-40" disabled={acting} onClick={() => decide(false)}>
              ✗ Reject
            </button>
            <button className="bg-border text-text-muted text-sm px-4 py-2.5 rounded-lg disabled:opacity-40" disabled={acting} onClick={() => decide(false)}>
              Skip →
            </button>
          </div>
        </div>
      )}

      {/* Transform log */}
      {log.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Applied Transforms</div>
          <div className="flex flex-col gap-1.5">
            {log.map(entry => (
              <div key={entry.id}>
                <div
                  className={`flex items-center gap-2.5 px-3 py-2 bg-surface border border-border rounded-lg text-xs cursor-pointer hover:border-indigo/30 transition-colors ${entry.status === 'rejected' ? 'opacity-50' : ''} ${expandedLogId === entry.id ? 'rounded-b-none border-b-0' : ''}`}
                  onClick={() => setExpandedLogId(expandedLogId === entry.id ? null : entry.id)}
                >
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 ${entry.status === 'applied' ? 'bg-success/20 text-success-light' : entry.status === 'no_effect' ? 'bg-amber-500/20 text-amber-400' : 'bg-danger/20 text-danger-light'}`}>
                    {entry.status === 'applied' ? '✓' : entry.status === 'no_effect' ? '~' : '✗'}
                  </div>
                  <span className="font-mono text-text-primary flex-1 truncate">{entry.type}{entry.params.column ? ` · ${entry.params.column}` : ''}</span>
                  <span className="text-text-muted">{entry.affected_rows.toLocaleString()} rows</span>
                  {entry.status === 'applied' && <span className="text-success-light font-semibold">+{Math.round(entry.score_delta * 100)}%</span>}
                  {entry.status === 'no_effect' && <span className="text-amber-400 text-xs">no effect</span>}
                  <span className="text-text-muted/50 ml-1">{expandedLogId === entry.id ? '▾' : '▸'}</span>
                </div>
                {expandedLogId === entry.id && (
                  <div className="px-3 py-3 bg-elevated border border-border border-t-0 rounded-b-lg">
                    {entry.rationale && (
                      <p className="text-xs text-text-muted leading-relaxed mb-3">{entry.rationale}</p>
                    )}
                    <div className="font-mono text-xs space-y-1">
                      {Object.entries(entry.params)
                        .filter(([k]) => k !== 'code')
                        .map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-text-muted/70">{k}:</span>
                            <span className="text-indigo-light">{String(v)}</span>
                          </div>
                        ))}
                    </div>
                    {entry.custom_code && (
                      <div className="mt-2">
                        <CodeBlock code={entry.custom_code} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
