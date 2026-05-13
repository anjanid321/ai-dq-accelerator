'use client'
import { useEffect, useState } from 'react'
import { getScorecard } from '@/lib/api'
import type { ScorecardResponse, TransformationLogEntry } from '@/lib/types'
import { CodeBlock } from './CodeBlock'

function TransformRow({ entry }: { entry: TransformationLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const isApplied = entry.status === 'applied'
  const hasDetail = Object.keys(entry.params ?? {}).length > 0 || entry.custom_code || entry.rationale || (entry.regressions && entry.regressions.length > 0)

  return (
    <div className={`border-b border-surface ${!isApplied ? 'opacity-50' : ''}`}>
      <div
        className={`grid grid-cols-[24px_2fr_1fr_1fr_80px] px-3.5 py-2.5 text-xs gap-2 items-center ${hasDetail ? 'cursor-pointer hover:bg-black/5' : ''}`}
        onClick={() => hasDetail && setExpanded(v => !v)}
      >
        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${isApplied ? 'bg-success/20 text-success-light' : 'bg-danger/20 text-danger-light'}`}>{isApplied ? '✓' : '✗'}</div>
        <span className="font-mono text-text-primary truncate flex items-center gap-1">
          {entry.type}{entry.params.column ? ` · ${entry.params.column}` : ''}
          {hasDetail && <span className="text-[10px] text-text-muted/40 ml-1">{expanded ? '▴' : '▾'}</span>}
        </span>
        <span className="text-text-muted">{entry.affected_rows.toLocaleString()}</span>
        <span className={isApplied ? 'text-success-light font-semibold' : 'text-text-muted'}>
          {isApplied ? `+${Math.round(entry.score_delta * 100)}%` : '—'}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded text-center ${isApplied ? 'bg-success/15 text-success-light' : 'bg-danger/15 text-danger-light'}`}>{entry.status}</span>
      </div>
      {expanded && hasDetail && (
        <div className="mx-3.5 mb-2.5 px-3 py-2.5 bg-elevated rounded-lg border border-border space-y-2 text-xs">
          {entry.rationale && (
            <div><span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Rationale</span><p className="text-text-muted mt-0.5">{entry.rationale}</p></div>
          )}
          {Object.keys(entry.params ?? {}).length > 0 && (
            <div>
              <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Params</span>
              <pre className="mt-0.5 text-[11px] text-text-muted/80 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(entry.params, null, 2)}</pre>
            </div>
          )}
          {entry.custom_code && (
            <div>
              <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Custom Code</span>
              <div className="mt-0.5 bg-surface rounded overflow-x-auto">
                <CodeBlock code={entry.custom_code} />
              </div>
            </div>
          )}
          {entry.post_step_per_rule && entry.post_step_per_rule.length > 0 && (
            <div>
              <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">
                Rule State After This Step
                <span className="ml-2 normal-case text-text-muted/40">
                  {entry.post_step_per_rule.filter(r => !r.passed).length} failing / {entry.post_step_per_rule.length} total
                </span>
              </span>
              <div className="mt-1 space-y-0.5">
                {entry.post_step_per_rule.map(rule => (
                  <div key={rule.id} className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] ${rule.passed ? 'opacity-40' : 'bg-red-500/10'}`}>
                    <span className={rule.passed ? 'text-success-light' : 'text-red-400'}>{rule.passed ? '✓' : '✗'}</span>
                    <span className="font-mono text-text-muted/80 shrink-0">{rule.id}</span>
                    {rule.column && <span className="text-text-muted/50 font-mono shrink-0">· {rule.column}</span>}
                    <span className="text-text-muted/60 truncate">{rule.check}</span>
                    {!rule.passed && <span className="text-red-400/70 shrink-0 ml-auto">{rule.failure_count.toLocaleString()} failures</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {entry.regressions && entry.regressions.length > 0 && (
            <div>
              <span className="text-text-muted/60 uppercase tracking-wider text-[10px]">Regressions</span>
              <pre className="mt-0.5 text-[11px] text-red-400/80 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(entry.regressions, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ScorecardStage({ sessionId }: { sessionId: string; readOnly?: boolean }) {
  const [data, setData] = useState<ScorecardResponse | null>(null)

  useEffect(() => {
    getScorecard(sessionId).then(setData).catch(() => {})
  }, [sessionId])

  if (!data) {
    return <div className="flex items-center justify-center h-full text-text-muted text-sm">Loading scorecard...</div>
  }

  const baseline = Math.round(data.baseline_score * 100)
  const final = Math.round(data.final_score * 100)
  const delta = Math.round(data.delta * 100)

  return (
    <div className="p-5">
      <h1 className="text-base font-bold text-text-primary mb-1">Quality Scorecard</h1>
      <p className="text-xs text-text-muted mb-4">Summary of all improvements made to your dataset</p>

      {/* Hero */}
      <div className="bg-surface border border-success/30 rounded-xl p-5 flex items-center gap-6 mb-4">
        <div className="flex items-end gap-4 shrink-0">
          <div className="text-center"><div className="text-5xl font-extrabold text-text-muted">{baseline}%</div><div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">Baseline</div></div>
          <div className="text-text-muted text-2xl pb-2">→</div>
          <div className="text-center"><div className="text-5xl font-extrabold text-success-light">{final}%</div><div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">Final</div></div>
        </div>
        <div className="w-px h-14 bg-border shrink-0" />
        <div className="text-center shrink-0">
          <div className="text-3xl font-bold text-success-light">+{delta}%</div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">Improvement</div>
        </div>
        <div className="flex-1">
          {[{ label: 'Before', pct: baseline, color: '#94a3b8' }, { label: 'After', pct: final, color: 'linear-gradient(90deg,#6366f1,#22c55e)' }].map(row => (
            <div key={row.label} className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] text-text-muted w-10 text-right">{row.label}</span>
              <div className="flex-1 bg-border rounded-full h-2.5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: row.color }} /></div>
              <span className="text-[11px] text-text-muted w-8">{row.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Original rows', value: data.original_rows.toLocaleString() },
          { label: 'Final rows', value: data.final_rows.toLocaleString(), color: 'text-success-light' },
          { label: 'Rows removed', value: data.rows_removed.toLocaleString(), color: 'text-danger-light' },
          { label: 'Rows modified', value: data.rows_modified.toLocaleString(), color: 'text-warning' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-border rounded-xl p-3.5 text-center">
            <div className={`text-xl font-bold ${color ?? 'text-text-primary'}`}>{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Narrative */}
      {data.narrative && (
        <div className="bg-indigo/10 border border-indigo/30 rounded-xl p-4 mb-4">
          <div className="text-[10px] uppercase tracking-widest text-indigo mb-2">✦ AI Narrative</div>
          <p className="text-xs text-indigo-light/90 leading-relaxed">{data.narrative}</p>
        </div>
      )}

      {/* Transform history */}
      {data.transformation_log.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Transform History</div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-[24px_2fr_1fr_1fr_80px] px-3.5 py-2 bg-elevated border-b border-border text-[10px] uppercase tracking-wider text-text-muted gap-2 items-center">
              <span/><span>Transform</span><span>Rows</span><span>Delta</span><span>Status</span>
            </div>
            {data.transformation_log.map(entry => (
              <TransformRow key={entry.id} entry={entry} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
