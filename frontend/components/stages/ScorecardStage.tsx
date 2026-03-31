'use client'
import { useEffect, useState } from 'react'
import { getScorecard } from '@/lib/api'
import type { ScorecardResponse } from '@/lib/types'

export function ScorecardStage({ sessionId }: { sessionId: string }) {
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
          {[{ label: 'Before', pct: baseline, color: '#374151' }, { label: 'After', pct: final, color: 'linear-gradient(90deg,#6366f1,#22c55e)' }].map(row => (
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
              <div key={entry.id} className={`grid grid-cols-[24px_2fr_1fr_1fr_80px] px-3.5 py-2.5 border-b border-surface text-xs gap-2 items-center ${entry.status === 'rejected' ? 'opacity-50' : ''}`}>
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${entry.status === 'applied' ? 'bg-success/20 text-success-light' : 'bg-danger/20 text-danger-light'}`}>{entry.status === 'applied' ? '✓' : '✗'}</div>
                <span className="font-mono text-text-primary truncate">{entry.type}{entry.params.column ? ` · ${entry.params.column}` : ''}</span>
                <span className="text-text-muted">{entry.affected_rows.toLocaleString()}</span>
                <span className={entry.status === 'applied' ? 'text-success-light font-semibold' : 'text-text-muted'}>
                  {entry.status === 'applied' ? `+${Math.round(entry.score_delta * 100)}%` : '—'}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded text-center ${entry.status === 'applied' ? 'bg-success/15 text-success-light' : 'bg-danger/15 text-danger-light'}`}>{entry.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
