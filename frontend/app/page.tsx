// frontend/app/page.tsx
'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionsList } from '@/hooks/useSessionsList'
import { SessionCard } from '@/components/sessions/SessionCard'
import { SessionsTopBar } from '@/components/sessions/SessionsTopBar'
import { EmptyState } from '@/components/sessions/EmptyState'
import { UploadModal } from '@/components/sessions/UploadModal'
import { stageCategory } from '@/lib/stages'

export default function HomePage() {
  const router = useRouter()
  const { sessions, refresh } = useSessionsList()
  const [showUpload, setShowUpload] = useState(false)

  // One-time cleanup of a legacy localStorage key (no behavior change vs. prior page).
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('dq_sessions') } catch {}
  }

  const grouped = useMemo(() => {
    const inProgress = sessions.filter((s) => stageCategory(s.stage) !== 'complete')
    const complete   = sessions.filter((s) => stageCategory(s.stage) === 'complete')
    return { inProgress, complete }
  }, [sessions])

  function handleCreated(id: string) {
    refresh()
    setShowUpload(false)
    router.push(`/sessions/${id}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SessionsTopBar onNewSession={() => setShowUpload(true)} />

      {sessions.length === 0 ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : (
        <div className="flex-1 bg-canvas p-6 flex flex-col gap-5">
          {grouped.inProgress.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">In progress</div>
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {grouped.inProgress.map((s) => (
                  <SessionCard
                    key={s.id}
                    entry={s}
                    onOpen={() => router.push(`/sessions/${s.id}`)}
                    onDeleted={() => refresh()}
                  />
                ))}
              </div>
            </section>
          )}

          {grouped.complete.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Complete</div>
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {grouped.complete.map((s) => (
                  <SessionCard
                    key={s.id}
                    entry={s}
                    onOpen={() => router.push(`/sessions/${s.id}`)}
                    onDeleted={() => refresh()}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showUpload && <UploadModal onCreated={handleCreated} onClose={() => setShowUpload(false)} />}
    </div>
  )
}
