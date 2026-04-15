'use client'
import type { SessionState } from '@/lib/types'
import { getPipelineDownloadUrl } from '@/lib/api'

const STAGE_LABELS: Record<string, string> = {
  LOADING: 'Loading',
  PROFILING: 'Profiling',
  RULE_REVIEW: 'Reviewing Rules',
  AWAITING_RULE_APPROVAL: 'Awaiting Rules',
  VALIDATING: 'Validating',
  TRANSFORMATION_LOOP: 'Transforming',
  AWAITING_PIPELINE_CONFIRMATION: 'Ready for Pipeline',
  GENERATING: 'Generating',
  COMPLETE: 'Complete',
}

const STAGE_COLORS: Record<string, string> = {
  LOADING: 'text-cyan-400 bg-cyan-400/10',
  PROFILING: 'text-cyan-400 bg-cyan-400/10',
  RULE_REVIEW: 'text-indigo-light bg-indigo/10',
  AWAITING_RULE_APPROVAL: 'text-warning bg-warning/10',
  VALIDATING: 'text-indigo-light bg-indigo/10',
  TRANSFORMATION_LOOP: 'text-indigo-light bg-indigo/10',
  AWAITING_PIPELINE_CONFIRMATION: 'text-indigo-light bg-indigo/10',
  GENERATING: 'text-indigo-light bg-indigo/10',
  COMPLETE: 'text-success-light bg-success/10',
}

interface Props {
  sessionId: string
  filename: string
  state: SessionState | null
  onOpen: () => void
}

export function SessionCard({ sessionId, filename, state, onOpen }: Props) {
  const stage = state?.stage ?? 'LOADING'
  const score = state?.current_score ?? 0
  const baseline = state?.baseline_quality_score ?? 0

  return (
    <div
      className="bg-surface border border-border rounded-xl p-[18px] cursor-pointer hover:border-indigo/40 transition-colors"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-text-primary text-sm">{filename}</div>
          <div className="text-xs text-text-muted mt-0.5">{state ? new Date().toLocaleDateString() : 'Loading...'}</div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STAGE_COLORS[stage] ?? ''}`}>
          {STAGE_LABELS[stage]}
        </span>
      </div>

      {stage === 'AWAITING_RULE_APPROVAL' && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 mb-3 text-xs text-warning-light">
          ⏸ {state?.suggested_rules.length ?? 0} rules need approval
        </div>
      )}
      {stage === 'TRANSFORMATION_LOOP' && state?.current_suggestion && (
        <div className="bg-indigo/10 border border-indigo/30 rounded-lg px-3 py-2 mb-3 text-xs text-indigo-light">
          ● Transform suggestion ready
        </div>
      )}

      {score > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Quality Score</span>
            <span className="font-semibold" style={{ color: score >= 0.9 ? '#4ade80' : score >= 0.7 ? '#f59e0b' : '#f87171' }}>
              {Math.round(score * 100)}%
              {stage === 'COMPLETE' && baseline > 0 && (
                <span className="text-success-light ml-1 text-[10px]">+{Math.round((score - baseline) * 100)}%</span>
              )}
            </span>
          </div>
          <div className="bg-border rounded h-1.5 overflow-hidden">
            <div className="h-full rounded transition-all" style={{ width: `${score * 100}%`, background: score >= 0.9 ? '#22c55e' : '#f59e0b' }} />
          </div>
        </div>
      )}

      {stage === 'COMPLETE' && (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <button className="flex-1 text-[11px] border border-border text-text-secondary px-2 py-1.5 rounded-md hover:bg-elevated">
            View Report
          </button>
          <a
            href={getPipelineDownloadUrl(sessionId)}
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
