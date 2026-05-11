'use client'
import { useState } from 'react'
import type { SessionListEntry } from '@/lib/types'
import { deleteSession, getPipelineDownloadUrl } from '@/lib/api'

const STAGE_LABELS: Record<string, string> = {
  LOADING: 'Loading',
  PROFILING: 'Profiling',
  AWAITING_INVESTIGATION_REVIEW: 'Reviewing Exploration',
  REINVESTIGATING: 'Investigating',
  PROFILING_SYNTHESIS: 'Synthesizing',
  RULE_REVIEW: 'Reviewing Rules',
  AWAITING_RULE_APPROVAL: 'Awaiting Rules',
  VALIDATING: 'Validating',
  TRIAGING: 'Triaging',
  AWAITING_TRIAGE_APPROVAL: 'Awaiting Triage',
  PLANNING: 'Planning',
  AWAITING_PLAN_APPROVAL: 'Awaiting Plan',
  TRANSFORMATION_LOOP: 'Transforming',
  AWAITING_HUMAN_INPUT: 'Awaiting Input',
  AWAITING_PIPELINE_CONFIRMATION: 'Ready for Pipeline',
  GENERATING: 'Generating',
  COMPLETE: 'Complete',
}

interface Props {
  entry: SessionListEntry
  onOpen: () => void
  onDeleted: () => void
}

export function SessionCard({ entry, onOpen, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const stage = entry.stage
  const score = entry.current_score ?? 0
  const baseline = entry.baseline_score ?? 0

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await deleteSession(entry.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="group relative bg-surface border border-border rounded-xl p-[18px] cursor-pointer hover:border-indigo/40 transition-colors"
      onClick={onOpen}
      onMouseLeave={() => setConfirming(false)}
    >
      <button
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger text-xs px-2 py-1 rounded"
        onClick={handleDelete}
        title={confirming ? 'Click again to confirm' : 'Delete session'}
      >
        {deleting ? '…' : confirming ? 'Confirm?' : '×'}
      </button>

      <div className="flex items-start justify-between mb-3 pr-6">
        <div>
          <div className="font-semibold text-text-primary text-sm">{entry.filename}</div>
          <div className="text-xs text-text-muted mt-0.5">{new Date(entry.created_at).toLocaleDateString()}</div>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo/10 text-indigo">
          {STAGE_LABELS[stage] ?? stage}
        </span>
      </div>

      {score > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Quality Score</span>
            <span className="font-semibold text-success">
              {Math.round(score * 100)}%
              {stage === 'COMPLETE' && baseline > 0 && (
                <span className="text-success ml-1 text-[10px]">+{Math.round((score - baseline) * 100)}%</span>
              )}
            </span>
          </div>
          <div className="bg-border rounded h-1.5 overflow-hidden">
            <div className="h-full rounded transition-all bg-success" style={{ width: `${score * 100}%` }} />
          </div>
        </div>
      )}

      {stage === 'COMPLETE' && (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <a
            href={getPipelineDownloadUrl(entry.id)}
            download
            className="flex-1 text-center text-[11px] border border-border text-text-secondary px-2 py-1.5 rounded-md hover:bg-elevated"
          >
            ↓ Download
          </a>
        </div>
      )}
    </div>
  )
}
