'use client'
import { Upload, UploadCloud } from 'lucide-react'

interface Props {
  onUpload: () => void
}

export function EmptyState({ onUpload }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center bg-canvas">
      <div className="max-w-md w-full bg-surface border border-border rounded-lg p-8 flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center text-fg-muted">
          <UploadCloud size={28} strokeWidth={2} />
        </div>
        <h2 className="text-base font-semibold text-fg text-center">
          Start your first data quality session
        </h2>
        <p className="text-sm text-fg-muted leading-relaxed text-center">
          Upload a CSV, Parquet, or JSON file. AI will profile it, suggest rules, and walk you through cleanup.
        </p>
        <button
          type="button"
          onClick={onUpload}
          data-testid="empty-state-upload"
          className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
        >
          <Upload size={14} strokeWidth={2} />
          Upload a dataset
        </button>
      </div>
    </div>
  )
}
