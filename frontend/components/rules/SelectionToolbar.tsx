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
      <input
        type="checkbox"
        aria-label="Select all visible"
        checked={allVisibleSelected}
        onChange={onToggleAllVisible}
        className="w-4 h-4 accent-brand-primary"
      />
      <span className="text-[12px] font-medium text-fg">
        Select all visible · {selectedCount} selected
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onBulkApprove}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-success text-success-deep text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Check size={14} strokeWidth={2} /> Approve {selectedCount || ''}
      </button>
      <button
        type="button"
        onClick={onBulkDeny}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-danger text-danger-deep text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={14} strokeWidth={2} /> Deny {selectedCount || ''}
      </button>
      <button
        type="button"
        onClick={onBulkClear}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-surface border-border-strong text-fg-muted text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RotateCcw size={14} strokeWidth={2} /> Clear {selectedCount || ''}
      </button>
    </div>
  )
}
