'use client'
import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronUp, X } from 'lucide-react'
import { getScorecard } from '@/lib/api'
import type { ScorecardResponse, TransformationLogEntry } from '@/lib/types'
import { Chip } from '@/components/ui/Chip'
import { toTitleCase } from '@/lib/text'
import { CodeBlock } from './CodeBlock'

interface Props {
  sessionId: string
  /**
   * When provided, skips the getScorecard fetch and renders directly against
   * the supplied data. Used by /demo to render the stage against frozen
   * fixtures.
   */
  data?: ScorecardResponse
  readOnly?: boolean
}

function TransformRow({ entry }: { entry: TransformationLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const isApplied = entry.status === 'applied'
  const hasDetail =
    Object.keys(entry.params ?? {}).length > 0 ||
    !!entry.custom_code ||
    !!entry.rationale ||
    (entry.regressions && entry.regressions.length > 0) ||
    (entry.post_step_per_rule && entry.post_step_per_rule.length > 0)

  return (
    <div className={`border-b border-border last:border-0 ${!isApplied ? 'opacity-60' : ''}`}>
      <div
        className={`grid grid-cols-[24px_2fr_1fr_1fr_100px_24px] px-4 py-2.5 text-xs gap-2 items-center ${
          hasDetail ? 'cursor-pointer hover:bg-elevated transition-colors' : ''
        }`}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <div className="w-5 h-5 flex items-center justify-center">
          {isApplied ? (
            <Check size={14} strokeWidth={2.5} className="text-success-deep" />
          ) : (
            <X size={14} strokeWidth={2.5} className="text-danger-deep" />
          )}
        </div>
        <span className="text-fg truncate flex items-center gap-1.5">
          {toTitleCase(entry.type)}
          {entry.params.column ? <span className="text-fg-subtle font-mono"> · {String(entry.params.column)}</span> : null}
        </span>
        <span className="text-fg-muted">{entry.affected_rows.toLocaleString()}</span>
        <span
          className={
            isApplied ? 'text-success-deep font-semibold' : 'text-fg-subtle'
          }
        >
          {isApplied ? `+${Math.round(entry.score_delta * 100)}%` : '—'}
        </span>
        <span className="justify-self-start">
          <Chip variant="status" tone={isApplied ? 'success' : 'danger'}>
            {toTitleCase(entry.status)}
          </Chip>
        </span>
        <div className="w-5 h-5 flex items-center justify-center text-fg-subtle">
          {hasDetail ? (
            expanded ? (
              <ChevronUp size={14} strokeWidth={2} />
            ) : (
              <ChevronDown size={14} strokeWidth={2} />
            )
          ) : null}
        </div>
      </div>
      {expanded && hasDetail && (
        <div className="mx-4 mt-1.5 mb-3 px-4 py-3 bg-canvas rounded-md border border-border-strong flex flex-col gap-3 text-xs">
          {entry.rationale && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Rationale
              </span>
              <p className="text-fg mt-1 leading-relaxed">{entry.rationale}</p>
            </div>
          )}
          {Object.keys(entry.params ?? {}).length > 0 && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Params
              </span>
              <pre className="mt-1 text-xs text-fg overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(entry.params, null, 2)}
              </pre>
            </div>
          )}
          {entry.custom_code && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Custom Code
              </span>
              <div className="mt-1 bg-surface rounded-md overflow-x-auto border border-border">
                <CodeBlock code={entry.custom_code} />
              </div>
            </div>
          )}
          {entry.post_step_per_rule && entry.post_step_per_rule.length > 0 && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Rule State After This Step
                <span className="ml-2 normal-case text-fg-subtle tracking-normal">
                  {entry.post_step_per_rule.filter((r) => !r.passed).length} failing /{' '}
                  {entry.post_step_per_rule.length} total
                </span>
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {entry.post_step_per_rule.map((rule) => (
                  <div
                    key={rule.id}
                    className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                      rule.passed ? 'opacity-50' : 'bg-danger/10'
                    }`}
                  >
                    {rule.passed ? (
                      <Check size={12} strokeWidth={2.5} className="text-success-deep shrink-0" />
                    ) : (
                      <X size={12} strokeWidth={2.5} className="text-danger-deep shrink-0" />
                    )}
                    <span className="font-mono text-fg-muted shrink-0">{rule.id}</span>
                    {rule.column && (
                      <span className="text-fg-subtle font-mono shrink-0">· {rule.column}</span>
                    )}
                    <span className="text-fg-muted truncate">{rule.check}</span>
                    {!rule.passed && (
                      <span className="text-danger-deep shrink-0 ml-auto font-semibold">
                        {rule.failure_count.toLocaleString()} failures
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {entry.regressions && entry.regressions.length > 0 && (
            <div>
              <span className="text-fg-subtle uppercase tracking-widest text-xs font-semibold">
                Regressions
              </span>
              <pre className="mt-1 text-xs text-danger-deep overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(entry.regressions, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ScorecardStage({ sessionId, data: dataProp }: Props) {
  const [data, setData] = useState<ScorecardResponse | null>(dataProp ?? null)

  useEffect(() => {
    if (dataProp) return
    getScorecard(sessionId).then(setData).catch(() => {})
  }, [sessionId, dataProp])

  if (!data) {
    return (
      <div className="p-5">
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Loading scorecard"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">Loading scorecard…</span>
        </div>
      </div>
    )
  }

  const baseline = Math.round(data.baseline_score * 100)
  const final = Math.round(data.final_score * 100)
  const delta = Math.round(data.delta * 100)

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Quality Scorecard</h1>
        <p className="text-xs text-fg-muted">
          Summary of every improvement made to your dataset across the transform pass.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <div className="text-5xl font-bold text-success-deep">
              {final}
              <span className="text-2xl text-fg-muted">%</span>
            </div>
            {final !== baseline && (
              <div className="text-xs text-fg-subtle mt-1">
                baseline: {baseline}%
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
              Quality Score
            </div>
            <div className="text-sm text-fg-muted">
              <span className="text-success-deep font-semibold">+{delta}% improvement</span>
              {' · '}
              <span className="text-success-deep font-semibold">
                {data.rules_passing} of {data.rules_total}
              </span>{' '}
              rules passing
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Original rows', value: data.original_rows.toLocaleString(), color: 'text-fg' },
          { label: 'Final rows', value: data.final_rows.toLocaleString(), color: 'text-success-deep' },
          { label: 'Rows removed', value: data.rows_removed.toLocaleString(), color: 'text-danger-deep' },
          { label: 'Rows modified', value: data.rows_modified.toLocaleString(), color: 'text-warning-deep' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-border rounded-xl p-4 text-center">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-xs uppercase tracking-widest text-fg-subtle font-semibold mt-1">
              {label}
            </div>
          </div>
        ))}
      </div>

      {data.narrative && (
        <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-xl p-4 flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent-purple-deep">
            ✦ AI NARRATIVE
          </div>
          <p className="text-xs text-accent-purple-deep leading-relaxed">{data.narrative}</p>
        </div>
      )}

      {data.transformation_log.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Transform History
          </div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-[24px_2fr_1fr_1fr_100px_24px] px-4 py-2 bg-elevated border-b border-border text-xs uppercase tracking-widest text-fg-subtle font-semibold gap-2 items-center">
              <span />
              <span>Transform</span>
              <span>Rows</span>
              <span>Delta</span>
              <span>Status</span>
              <span />
            </div>
            {data.transformation_log.map((entry) => (
              <TransformRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
