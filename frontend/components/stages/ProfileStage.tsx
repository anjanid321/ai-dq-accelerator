'use client'
import type { SessionState } from '@/lib/types'

interface Props {
  session: SessionState
  onContinue: () => void
  readOnly?: boolean
}

type VarInfo = { type: string; n_missing: number; p_missing: number; n_distinct: number }

export function ProfileStage({ session, onContinue, readOnly }: Props) {
  const profile = session.profile as any
  const table = profile?.table ?? {}
  const alerts: { column?: string; type?: string; description?: string }[] = profile?.alerts ?? []
  const variables: Record<string, VarInfo> = profile?.variables_summary ?? {}
  const completeness = table.p_cells_missing != null ? Math.round((1 - table.p_cells_missing) * 100) : null

  const isReady = !!session.ai_summary

  return (
    <div className="p-5">
      <h1 className="text-base font-bold text-text-primary mb-1">Data Profile</h1>
      <p className="text-xs text-text-muted mb-4">AI analysis of your dataset structure and quality characteristics</p>

      {/* AI summary */}
      {session.ai_summary && (
        <div className="bg-indigo/10 border border-indigo/30 rounded-xl p-4 mb-4">
          <div className="text-[10px] uppercase tracking-widest text-indigo mb-2">✦ AI Summary</div>
          <p className="text-xs text-indigo-light/90 leading-relaxed">{session.ai_summary}</p>
        </div>
      )}

      {!session.ai_summary && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-4 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-indigo border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-xs text-text-muted">AI is analyzing your dataset...</span>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: 'Completeness', value: completeness != null ? `${completeness}%` : '—', color: completeness != null && completeness >= 90 ? 'text-success-light' : 'text-warning', pct: completeness },
          { label: 'Rows', value: table.n_rows?.toLocaleString() ?? '—', color: 'text-text-primary' },
          { label: 'Columns', value: table.n_columns ?? '—', color: 'text-text-primary' },
          { label: 'Alerts', value: alerts.length, color: alerts.length > 0 ? 'text-danger-light' : 'text-text-primary' },
        ].map(({ label, value, color, pct }) => (
          <div key={label} className="bg-surface border border-border rounded-xl p-3.5">
            <div className="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">{label}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            {pct != null && (
              <div className="mt-2 bg-border rounded h-1"><div className="h-full rounded" style={{ width: `${pct}%`, background: pct >= 90 ? '#22c55e' : '#f59e0b' }} /></div>
            )}
          </div>
        ))}
      </div>

      {/* Column table */}
      {Object.keys(variables).length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Column Breakdown</div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden mb-4">
            <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr] px-3.5 py-2 bg-elevated border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <span>Column</span><span>Type</span><span>Nulls</span><span>Null Rate</span>
            </div>
            {Object.entries(variables).map(([col, info]) => {
              const pct = Math.round(info.p_missing * 100)
              const high = pct > 5
              return (
                <div key={col} className={`grid grid-cols-[2fr_1fr_1fr_1.5fr] px-3.5 py-2 border-b border-surface text-xs ${high ? 'bg-danger/5' : ''}`}>
                  <span className="font-mono text-text-primary truncate">{col}</span>
                  <span className="text-text-muted">{info.type}</span>
                  <span className={high ? 'text-danger-light' : 'text-text-muted'}>{info.n_missing.toLocaleString()}</span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-border rounded h-1"><div className="h-full rounded" style={{ width: `${pct}%`, background: high ? '#ef4444' : '#22c55e' }} /></div>
                    <span className={`text-[10px] w-7 ${high ? 'text-danger-light' : 'text-text-muted'}`}>{pct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {isReady && !readOnly && (
        <div className="flex justify-end">
          <button className="bg-indigo text-white text-sm font-medium px-5 py-2 rounded-lg" onClick={onContinue}>
            Continue to Rules →
          </button>
        </div>
      )}
    </div>
  )
}
