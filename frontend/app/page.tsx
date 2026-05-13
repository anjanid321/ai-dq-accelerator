'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionsList } from '@/hooks/useSessionsList'
import { SessionCard } from '@/components/sessions/SessionCard'
import { UploadModal } from '@/components/sessions/UploadModal'

export default function HomePage() {
  const router = useRouter()
  const { sessions, refresh } = useSessionsList()
  const [showUpload, setShowUpload] = useState(false)

  // Clean up legacy localStorage key on first load
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem('dq_sessions') } catch {}
  }

  function handleCreated(id: string) {
    refresh()
    setShowUpload(false)
    router.push(`/sessions/${id}`)
  }

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>⬡</div>
          <div>
            <div className="font-semibold text-text-primary">DQ Accelerator</div>
            <div className="text-xs text-text-muted">AI-powered data quality pipeline</div>
          </div>
        </div>
        <button className="bg-indigo text-white text-sm font-medium px-4 py-2 rounded-lg" onClick={() => setShowUpload(true)}>
          + New Session
        </button>
      </div>

      {sessions.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-text-muted mb-3">Recent Sessions</div>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {sessions.map(s => (
              <SessionCard
                key={s.id}
                entry={s}
                onOpen={() => router.push(`/sessions/${s.id}`)}
                onDeleted={() => refresh()}
              />
            ))}
            <div
              className="bg-surface border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center min-h-[160px] cursor-pointer hover:border-indigo/30 gap-2"
              onClick={() => setShowUpload(true)}
            >
              <div className="w-9 h-9 rounded-full border border-dashed border-border flex items-center justify-center text-text-muted text-xl">+</div>
              <div className="text-center"><div className="text-sm text-text-muted font-medium">Upload a dataset</div><div className="text-xs text-border mt-0.5">CSV, Parquet, or JSON</div></div>
            </div>
          </div>
        </>
      )}

      {sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="text-text-muted text-sm">No sessions yet</div>
          <button className="bg-indigo text-white text-sm font-medium px-5 py-2.5 rounded-lg" onClick={() => setShowUpload(true)}>Upload your first dataset →</button>
        </div>
      )}

      {showUpload && <UploadModal onCreated={handleCreated} onClose={() => setShowUpload(false)} />}
    </div>
  )
}
