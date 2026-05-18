// frontend/components/sessions/SessionCard.tsx
'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'
import type { SessionListEntry } from '@/lib/types'
import { deleteSession, getPipelineDownloadUrl } from '@/lib/api'
import { STAGE_LABELS, stageCategory, stageDetail, type StageCategory } from '@/lib/stages'

interface Props {
  entry: SessionListEntry
  onOpen: () => void
  onDeleted: () => void
}

type ScoreVariant = 'success' | 'warning' | 'danger'
function scoreVariant(score: number): ScoreVariant {
  if (score >= 0.9) return 'success'
  if (score >= 0.7) return 'warning'
  return 'danger'
}

const CHIP_CLASSES: Record<StageCategory, string> = {
  awaiting: 'bg-warning/15 text-warning-deep',
  progress: 'bg-info/15 text-info-deep',
  complete: 'bg-success/15 text-success-deep',
}

const SCORE_TEXT: Record<ScoreVariant, string> = {
  success: 'text-success-deep',
  warning: 'text-warning-deep',
  danger:  'text-danger-deep',
}
const SCORE_TRACK: Record<ScoreVariant, string> = {
  success: 'bg-success/20',
  warning: 'bg-warning/20',
  danger:  'bg-danger/20',
}
const SCORE_FILL: Record<ScoreVariant, string> = {
  success: 'bg-success-deep',
  warning: 'bg-warning-deep',
  danger:  'bg-danger-deep',
}

export function SessionCard({ entry, onOpen, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const category = stageCategory(entry.stage)
  const score = entry.current_score ?? 0
  const variant = scoreVariant(score)
  const isComplete = entry.stage === 'COMPLETE'
  const detail = stageDetail(entry)

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
      data-testid="session-card"
      className="group relative bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-fg-muted transition-colors flex flex-col gap-3"
      onClick={onOpen}
      onMouseLeave={() => setConfirming(false)}
    >
      <button
        type="button"
        data-testid="session-delete"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-fg-muted hover:text-danger-deep text-xs px-2 py-1 rounded-md"
        onClick={handleDelete}
        title={confirming ? 'Click again to confirm' : 'Delete session'}
      >
        {deleting ? '…' : confirming ? 'Confirm?' : '×'}
      </button>

      <div className="flex items-start gap-2 pr-6">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="text-sm font-semibold text-fg truncate">{entry.filename}</div>
          <div className="text-xs text-fg-muted">{new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          {detail && (
            <div data-testid="stage-detail" className="text-[11px] font-medium text-fg-subtle">
              {detail}
            </div>
          )}
        </div>
        <span
          data-stage-category={category}
          className={[
            'inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold tracking-tight shrink-0',
            CHIP_CLASSES[category],
          ].join(' ')}
        >
          {STAGE_LABELS[entry.stage]}
        </span>
      </div>

      {score > 0 && (
        <div data-testid="score-block" data-score-variant={variant} className="flex flex-col gap-1.5">
          <div className="flex items-baseline">
            <span className="text-xs text-fg-muted">Quality Score</span>
            <span className="flex-1" />
            <span className={`text-xs font-semibold ${SCORE_TEXT[variant]}`}>{Math.round(score * 100)}%</span>
          </div>
          <div className={`h-1.5 rounded-full overflow-hidden ${SCORE_TRACK[variant]}`}>
            <div
              className={`h-full rounded-full ${SCORE_FILL[variant]}`}
              style={{ width: `${score * 100}%` }}
            />
          </div>
        </div>
      )}

      {isComplete && (
        <a
          href={getPipelineDownloadUrl(entry.id)}
          download
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center gap-1.5 w-full bg-surface border border-border-strong text-fg-muted text-[11px] font-medium px-2 py-1.5 rounded-md hover:bg-elevated"
        >
          <Download size={14} strokeWidth={2} />
          Download
        </a>
      )}
    </div>
  )
}
