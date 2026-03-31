'use client'
import { useRef, useState } from 'react'
import { createSession } from '@/lib/api'

interface Props {
  onCreated: (id: string, filename: string) => void
  onClose: () => void
}

export function UploadModal({ onCreated, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [useCase, setUseCase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const res = await createSession(file, useCase)
      onCreated(res.session_id, file.name)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="font-semibold text-text-primary mb-1">Upload Dataset</div>
        <div className="text-xs text-text-muted mb-4">Start a new AI-powered data quality session</div>

        <div
          className="border-2 border-dashed border-border rounded-lg p-6 text-center text-text-muted text-xs mb-3 cursor-pointer hover:border-indigo/40"
          onClick={() => inputRef.current?.click()}
        >
          {file ? (
            <span className="text-text-primary font-medium">{file.name}</span>
          ) : (
            <>Drop your file here or <span className="text-indigo-light underline">browse</span><div className="mt-1 text-border">.csv · .parquet · .json</div></>
          )}
          <input ref={inputRef} type="file" accept=".csv,.parquet,.json" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>

        <input
          className="w-full bg-bg border border-border text-text-primary rounded-md px-3 py-2 text-xs mb-3 outline-none focus:border-indigo/50"
          placeholder="Use case (optional) — e.g. 'Clean customer CRM data'"
          value={useCase}
          onChange={e => setUseCase(e.target.value)}
        />

        {error && <div className="text-danger-light text-xs mb-2">{error}</div>}

        <button
          className="w-full bg-indigo text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-40"
          disabled={!file || loading}
          onClick={handleSubmit}
        >
          {loading ? 'Starting...' : 'Start Session →'}
        </button>
      </div>
    </div>
  )
}
