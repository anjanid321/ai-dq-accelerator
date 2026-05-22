'use client'
import { Check, X, RotateCcw } from 'lucide-react'

interface Props {
  selectedCount: number
  allVisibleSelected: boolean
  onToggleAllVisible: () => void
  onBulkApprove: () => void
  onBulkDeny: () => void
  onBulkClear: () => void
}

export function SelectionToolbar({
  selectedCount, allVisibleSelected,
  onToggleAllVisible, onBulkApprove, onBulkDeny, onBulkClear,
}: Props) {
  const disabled = selectedCount === 0
  return (
    <div
      data-testid="selection-toolbar"
      className="bg-elevated border border-border rounded-lg px-4 py-2.5 flex items-center gap-3"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={allVisibleSelected}
        aria-label="Select all visible"
        onClick={onToggleAllVisible}
        className={[
          'shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors',
          allVisibleSelected
            ? 'bg-brand-primary border-brand-primary text-on-brand'
            : 'bg-surface border-border-strong hover:border-fg-muted',
        ].join(' ')}
      >
        {allVisibleSelected && <Check size={14} strokeWidth={3} />}
      </button>
      <span className="text-[12px] font-medium text-fg">
        Select all visible · {selectedCount} selected
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onBulkApprove}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-success text-success-deep text-[13px] font-medium transition-colors hover:bg-success/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
      >
        <Check size={14} strokeWidth={2} /> Approve {selectedCount || ''}
      </button>
      <button
        type="button"
        onClick={onBulkDeny}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-danger text-danger-deep text-[13px] font-medium transition-colors hover:bg-danger/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
      >
        <X size={14} strokeWidth={2} /> Deny {selectedCount || ''}
      </button>
      <button
        type="button"
        onClick={onBulkClear}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-border-strong text-fg-muted text-[13px] font-medium transition-colors hover:bg-elevated hover:border-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:border-border-strong disabled:hover:text-fg-muted"
      >
        <RotateCcw size={14} strokeWidth={2} /> Clear {selectedCount || ''}
      </button>
    </div>
  )
}
