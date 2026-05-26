// frontend/components/stages/ProfileStage.tsx
'use client'
import { ArrowRight } from 'lucide-react'
import type { SessionState } from '@/lib/types'
import { AlertRow, type AlertEntry } from './_profile/AlertRow'

interface Props {
  session: SessionState
  onContinue: () => void
  readOnly?: boolean
}

interface TableInfo {
  n_rows?: number
  n_columns?: number
  p_cells_missing?: number
}

export function ProfileStage({ session, onContinue, readOnly }: Props) {
  const profile = (session.profile ?? {}) as Record<string, unknown>
  const table = (profile.table ?? {}) as TableInfo
  const alerts: AlertEntry[] = (profile.alerts as AlertEntry[]) ?? []
  const completeness =
    table.p_cells_missing != null ? Math.round((1 - table.p_cells_missing) * 100) : null
  const isReady = !!session.ai_summary
  const showContinue = isReady && !readOnly

  return (
    <div className="p-5 flex flex-col gap-4">
      {/* Heading */}
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Data Profile</h1>
        <p className="text-xs text-fg-muted">
          AI analysis of your dataset structure and quality characteristics
        </p>
      </div>

      {/* AI Summary card — populated or loading */}
      {session.ai_summary ? (
        <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-xl pt-3.5 px-4 pb-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent-purple-deep">
            ✦ AI SUMMARY
          </div>
          <p className="text-xs text-accent-purple-deep leading-relaxed">
            {session.ai_summary}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl pt-3.5 px-4 pb-4 flex items-center gap-3">
          <div
            role="status"
            aria-label="Analyzing"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">AI is analyzing your dataset…</span>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Completeness */}
        <div className="bg-surface border border-border rounded-xl pt-3.5 px-4 pb-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Completeness
          </div>
          <div
            className={`text-2xl font-bold ${
              completeness != null && completeness >= 90
                ? 'text-success-deep'
                : 'text-warning-deep'
            }`}
          >
            {completeness != null ? `${completeness}%` : '—'}
          </div>
          {completeness != null && (
            <div className="mt-2 bg-border rounded h-1 overflow-hidden">
              <div
                className={`h-full rounded ${
                  completeness >= 90 ? 'bg-success-deep' : 'bg-warning-deep'
                }`}
                style={{ width: `${completeness}%` }}
              />
            </div>
          )}
        </div>

        {/* Rows */}
        <div className="bg-surface border border-border rounded-xl pt-3.5 px-4 pb-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Rows
          </div>
          <div className="text-2xl font-bold text-fg">
            {table.n_rows != null ? table.n_rows.toLocaleString() : '—'}
          </div>
        </div>

        {/* Columns */}
        <div className="bg-surface border border-border rounded-xl pt-3.5 px-4 pb-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Columns
          </div>
          <div className="text-2xl font-bold text-fg">
            {table.n_columns != null ? table.n_columns : '—'}
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-surface border border-border rounded-xl pt-3.5 px-4 pb-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Alerts
          </div>
          <div
            className={`text-2xl font-bold ${
              alerts.length > 0 ? 'text-warning-deep' : 'text-fg'
            }`}
          >
            {alerts.length}
          </div>
        </div>
      </div>

      {/* Alerts list */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Alerts ({alerts.length})
          </div>
          <ul className="flex flex-col gap-2 m-0 p-0">
            {alerts.map((alert, i) => (
              <AlertRow key={i} alert={alert} />
            ))}
          </ul>
        </div>
      )}

      {/* Continue CTA */}
      {showContinue && (
        <div className="flex justify-end mt-2">
          <button
            type="button"
            onClick={onContinue}
            data-testid="profile-continue"
            className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
          >
            Continue to Rules
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  )
}
