// frontend/components/sessions/SessionCard.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { Download, MoreVertical, Trash2 } from 'lucide-react'
import type { SessionListEntry } from '@/lib/types'
import { deleteSession, getPipelineDownloadUrl } from '@/lib/api'
import { STAGE_LABELS, stageCategory, stageDetail, type StageCategory } from '@/lib/stages'
import { Chip, type StatusTone } from '@/components/ui/Chip'

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

const CATEGORY_TONE: Record<StageCategory, StatusTone> = {
  awaiting: 'warning',
  progress: 'info',
  complete: 'success',
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const category = stageCategory(entry.stage)
  const score = entry.current_score ?? 0
  const variant = scoreVariant(score)
  const isComplete = entry.stage === 'COMPLETE'
  const detail = stageDetail(entry)

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setConfirming(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  function handleEditClick(e: React.MouseEvent) {
    e.stopPropagation()
    setMenuOpen((prev) => !prev)
    setConfirming(false)
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await deleteSession(entry.id)
      onDeleted()
    } finally {
      setDeleting(false)
      setMenuOpen(false)
    }
  }

  return (
    <div
      data-testid="session-card"
      className="group relative bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-fg-muted hover:shadow-md transition-all flex flex-col gap-3"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2">
        <Chip
          variant="status"
          tone={CATEGORY_TONE[category]}
        >
          <span data-stage-category={category}>{STAGE_LABELS[entry.stage]}</span>
        </Chip>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            data-testid="session-edit"
            onClick={handleEditClick}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Edit session"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-muted hover:text-fg hover:bg-elevated transition-colors"
          >
            <MoreVertical size={16} strokeWidth={2} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-full right-0 mt-1 min-w-[180px] bg-surface border border-border rounded-md shadow-lg overflow-hidden z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                data-testid="session-delete"
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 w-full px-3 py-2 text-[13px] font-medium text-danger-deep hover:bg-danger/10 transition-colors text-left disabled:opacity-50"
              >
                <Trash2 size={14} strokeWidth={2} />
                {deleting ? 'Deleting…' : confirming ? 'Confirm delete?' : 'Delete session'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-sm font-semibold text-fg truncate">{entry.filename}</div>
        <div className="text-xs text-fg-muted">{new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        {detail && (
          <div data-testid="stage-detail" className="text-xs font-medium text-fg-subtle">
            {detail}
          </div>
        )}
      </div>

      {score > 0 && (
        <div data-testid="score-block" data-score-variant={variant} className="flex flex-col gap-1.5 mt-auto">
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
          className="inline-flex items-center justify-center gap-1.5 w-full bg-surface border border-border-strong text-fg-muted text-xs font-medium px-2 py-1.5 rounded-md hover:bg-elevated hover:border-fg-muted hover:text-fg transition-colors"
        >
          <Download size={14} strokeWidth={2} />
          Download
        </a>
      )}
    </div>
  )
}
