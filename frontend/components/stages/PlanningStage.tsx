'use client'

interface Props {
  message?: string
}

export function PlanningStage({ message }: Props) {
  return (
    <div className="p-5">
      <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
        <div
          role="status"
          aria-label="Planning"
          className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
        />
        <span className="text-xs text-fg-muted">
          {message ?? 'AI is building your transformation plan…'}
        </span>
      </div>
    </div>
  )
}
