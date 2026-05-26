'use client'
import { useRef, useState } from 'react'
import { ArrowRight, UploadCloud, X } from 'lucide-react'
import { createSession } from '@/lib/api'
import { Chip } from '@/components/ui/Chip'

interface Props {
  onCreated: (id: string) => void
  onClose: () => void
  // Demo/preview only: when true, skip the API call and resolve with a fake
  // session id after a brief loading flash so the modal can be reviewed in
  // /demo without a running backend.
  demoMode?: boolean
}

const ACCEPTED_TYPES = ['.csv', '.parquet', '.json']

export function UploadModal({ onCreated, onClose, demoMode }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [useCase, setUseCase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  async function handleSubmit() {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      if (demoMode) {
        await new Promise((r) => setTimeout(r, 600))
        onCreated('demo')
        return
      }
      const res = await createSession(file, useCase)
      onCreated(res.session_id)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function handleFiles(files: FileList | null) {
    const next = files?.[0] ?? null
    setFile(next)
    setError('')
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!dragging) setDragging(true)
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Upload dataset"
        className="bg-surface border border-border rounded-xl w-full max-w-md mx-4 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center bg-elevated px-4 py-2.5 border-b border-border">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <div className="text-sm font-semibold text-fg">Upload dataset</div>
            <div className="text-xs text-fg-muted">
              Start a new AI-powered data quality session
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-muted hover:text-fg hover:bg-canvas transition-colors shrink-0"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3">
          {/* Drop zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-6 text-center flex flex-col items-center gap-2 cursor-pointer transition-colors ${
              dragging
                ? 'border-brand-primary bg-brand-primary/5'
                : 'border-border hover:border-brand-primary'
            }`}
          >
            <UploadCloud size={24} strokeWidth={2} className="text-fg-muted" />
            <div className="text-xs text-fg-muted">
              {file ? (
                <span className="text-fg font-medium">{file.name}</span>
              ) : (
                <>
                  Drop your file here or{' '}
                  <span className="text-brand-primary font-medium">browse</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              {ACCEPTED_TYPES.map((t) => (
                <Chip key={t} variant="neutral">{t}</Chip>
              ))}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* Selected file row — only when a file is picked */}
          {file && (
            <div className="flex items-center bg-surface border border-border rounded-md px-3 py-2">
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="text-xs font-medium text-fg truncate">{file.name}</div>
                <div className="text-xs text-fg-muted">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setFile(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
                aria-label="Remove file"
                className="inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-muted hover:text-fg hover:bg-elevated transition-colors shrink-0"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          )}

          {/* Use case */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Use case (optional)
            </label>
            <input
              className="w-full bg-canvas border border-border text-fg rounded-md px-3 py-2 text-xs placeholder:text-fg-subtle focus:outline-none focus:border-brand-primary transition-colors"
              placeholder="e.g. Clean customer CRM data"
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-danger/15 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger-deep">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-elevated">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex items-center gap-1.5 bg-surface border border-border text-fg-muted text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-canvas hover:border-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!file || loading}
            className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Starting…' : 'Start session'}
            {!loading && <ArrowRight size={14} strokeWidth={2} />}
          </button>
        </div>
      </div>
    </div>
  )
}
