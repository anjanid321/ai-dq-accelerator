'use client'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { SessionCard } from '@/components/sessions/SessionCard'
import { SessionsTopBar } from '@/components/sessions/SessionsTopBar'
import { EmptyState } from '@/components/sessions/EmptyState'
import { stageCategory } from '@/lib/stages'
import type { SessionListEntry } from '@/lib/types'

const MOCK_SESSIONS: SessionListEntry[] = [
  {
    id: 'm1',
    filename: 'loans.csv',
    stage: 'AWAITING_RULE_APPROVAL',
    current_score: 0.72,
    baseline_score: 0.5,
    created_at: '2026-05-15T12:00:00Z',
    updated_at: '2026-05-15T12:00:00Z',
    rule_count: 14,
  } as SessionListEntry,
  {
    id: 'm2',
    filename: 'transactions_q1.parquet',
    stage: 'VALIDATING',
    current_score: 0.81,
    baseline_score: 0.6,
    created_at: '2026-05-12T09:30:00Z',
    updated_at: '2026-05-12T09:30:00Z',
  },
  {
    id: 'm3',
    filename: 'customer_dim.csv',
    stage: 'PROFILING',
    current_score: 0,
    baseline_score: 0,
    created_at: '2026-05-17T15:45:00Z',
    updated_at: '2026-05-17T15:45:00Z',
  },
  {
    id: 'm4',
    filename: 'inventory_snapshot.json',
    stage: 'AWAITING_PLAN_APPROVAL',
    current_score: 0.68,
    baseline_score: 0.55,
    created_at: '2026-05-10T08:15:00Z',
    updated_at: '2026-05-10T08:15:00Z',
  },
  {
    id: 'm5',
    filename: 'shipments.csv',
    stage: 'TRANSFORMATION_LOOP',
    current_score: 0.79,
    baseline_score: 0.6,
    created_at: '2026-05-14T11:20:00Z',
    updated_at: '2026-05-14T11:20:00Z',
  },
  {
    id: 'm6',
    filename: 'support_tickets.csv',
    stage: 'AWAITING_TRIAGE_APPROVAL',
    current_score: 0.74,
    baseline_score: 0.58,
    created_at: '2026-05-11T14:00:00Z',
    updated_at: '2026-05-11T14:00:00Z',
    finding_count: 23,
  } as SessionListEntry,
  {
    id: 'm7',
    filename: 'sales_2025.parquet',
    stage: 'COMPLETE',
    current_score: 0.92,
    baseline_score: 0.74,
    created_at: '2026-05-08T16:30:00Z',
    updated_at: '2026-05-08T16:30:00Z',
  },
  {
    id: 'm8',
    filename: 'marketing_leads.csv',
    stage: 'COMPLETE',
    current_score: 0.78,
    baseline_score: 0.62,
    created_at: '2026-05-05T10:00:00Z',
    updated_at: '2026-05-05T10:00:00Z',
  },
  {
    id: 'm9',
    filename: 'legacy_customers.csv',
    stage: 'COMPLETE',
    current_score: 0.58,
    baseline_score: 0.42,
    created_at: '2026-05-02T13:45:00Z',
    updated_at: '2026-05-02T13:45:00Z',
  },
]

export default function PreviewSessionsPage() {
  const params = useSearchParams()
  const empty = params.get('empty') === '1'
  const sessions = empty ? [] : MOCK_SESSIONS
  const [showBanner, setShowBanner] = useState(true)

  const grouped = useMemo(() => {
    const inProgress = sessions.filter((s) => stageCategory(s.stage) !== 'complete')
    const complete = sessions.filter((s) => stageCategory(s.stage) === 'complete')
    return { inProgress, complete }
  }, [sessions])

  return (
    <div className="min-h-screen flex flex-col">
      {showBanner && (
        <div className="bg-warning/15 text-warning-deep text-xs px-4 py-2 flex items-center gap-3 border-b border-warning/30">
          <span className="font-semibold">PREVIEW</span>
          <span>Mock data — buttons are inert. Add <code>?empty=1</code> to see the empty state.</span>
          <span className="flex-1" />
          <button onClick={() => setShowBanner(false)} className="hover:underline">dismiss</button>
        </div>
      )}

      <SessionsTopBar onNewSession={() => alert('Upload modal would open here.')} />

      {sessions.length === 0 ? (
        <EmptyState onUpload={() => alert('Upload modal would open here.')} />
      ) : (
        <div className="flex-1 bg-canvas p-6 flex flex-col gap-5">
          {grouped.inProgress.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-widest text-fg-muted">In progress</div>
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {grouped.inProgress.map((s) => (
                  <SessionCard key={s.id} entry={s} onOpen={() => {}} onDeleted={() => {}} />
                ))}
              </div>
            </section>
          )}

          {grouped.complete.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="text-[10px] uppercase tracking-widest text-fg-muted">Complete</div>
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {grouped.complete.map((s) => (
                  <SessionCard key={s.id} entry={s} onOpen={() => {}} onDeleted={() => {}} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
