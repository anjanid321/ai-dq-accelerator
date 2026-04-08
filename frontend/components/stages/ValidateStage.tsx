'use client'
import type { SessionState, PerRuleResult } from '@/lib/types'

interface Props {
  session: SessionState | null
}

function CategoryPill({ label, score }: { label: string; score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-raised text-xs text-text-muted border border-border">
      <span className="capitalize">{label}</span>
      <span className="font-semibold text-text">{Math.round(score * 100)}%</span>
    </span>
  )
}

function SampleRows({ rows, targetColumn }: { rows: Record<string, unknown>[]; targetColumn?: string }) {
  if (!rows.length) return null
  const allKeys = Object.keys(rows[0])
  // Show target column first, then up to 2 others
  const keys = targetColumn && allKeys.includes(targetColumn)
    ? [targetColumn, ...allKeys.filter(k => k !== targetColumn).slice(0, 2)]
    : allKeys.slice(0, 3)

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {keys.map(k => (
              <th key={k} className="text-left px-2 py-1 text-text-muted/70 font-medium border-b border-border/50">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 3).map((row, i) => (
            <tr key={i} className="border-b border-border/30 last:border-0">
              {keys.map(k => (
                <td key={k} className="px-2 py-1 text-text-muted font-mono truncate max-w-[160px]">
                  {row[k] === null || row[k] === undefined ? <span className="italic text-text-muted/50">null</span> : String(row[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RuleCard({ rule }: { rule: PerRuleResult }) {
  const hasError = !!rule.error
  const failed = !rule.passed && !hasError

  const borderColor = hasError
    ? 'border-l-amber-500'
    : failed ? 'border-l-red-500' : 'border-l-success'

  return (
    <div className={`rounded-lg bg-surface-raised border border-border p-3 border-l-2 ${borderColor}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-text truncate">
            {rule.column ?? 'table-level'}
          </span>
          <span className="text-xs text-text-muted/70 font-mono">{rule.check}</span>
          {rule.rationale && (
            <span className="text-xs text-text-muted/60 leading-snug">{rule.rationale}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {failed && (
            <span className="text-xs text-text-muted/70">
              {(rule.failure_rate * 100).toFixed(1)}% of rows
            </span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${hasError ? 'bg-amber-500/15 text-amber-400' : failed ? 'bg-red-500/15 text-red-400' : 'bg-success/15 text-success'}`}>
            {hasError ? 'EVAL ERROR' : failed ? `FAILED · ${rule.failure_count}` : 'PASSED'}
          </span>
        </div>
      </div>
      {hasError && (
        <div className="mt-2 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 text-[11px] font-mono text-amber-300 break-all">
          {rule.error}
        </div>
      )}
      {!hasError && failed && rule.sample_failing_rows.length > 0 && (
        <SampleRows rows={rule.sample_failing_rows} targetColumn={rule.column ?? undefined} />
      )}
    </div>
  )
}

function ProseSection({ title, body }: { title: string; body: string }) {
  if (!body) return null
  return (
    <div className="rounded-lg bg-surface-raised border border-border p-4">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">{title}</h3>
      <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap">{body}</p>
    </div>
  )
}

export function ValidateStage({ session }: Props) {
  const results = session?.validation_results
  const perRule = results?.per_rule

  if (!perRule?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted p-8">
        <div className="w-8 h-8 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
        <div className="text-sm text-center">AI is running validation rules against your dataset...</div>
        <div className="text-xs text-text-muted/60 text-center">The AI panel on the right shows live progress.</div>
      </div>
    )
  }

  const score = session?.current_score ?? session?.baseline_quality_score ?? 0
  const baseline = session?.baseline_quality_score ?? 0
  const errored = perRule.filter(r => !!r.error).length
  const passed = perRule.filter(r => r.passed && !r.error).length
  const failed = perRule.length - passed - errored
  const categoryScores = results?.category_scores ?? {}
  const sortedRules = [...perRule].sort((a, b) => {
    const aTop = !a.passed || !!a.error
    const bTop = !b.passed || !!b.error
    if (aTop !== bTop) return aTop ? -1 : 1
    return b.failure_count - a.failure_count
  })

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Score header */}
      <div className="rounded-xl bg-surface-raised border border-border p-5">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-5xl font-bold text-text">{Math.round(score * 100)}<span className="text-2xl text-text-muted">%</span></div>
            {score !== baseline && (
              <div className="text-xs text-text-muted/60 mt-1">baseline: {Math.round(baseline * 100)}%</div>
            )}
          </div>
          <div>
            <div className="text-xs text-text-muted uppercase tracking-wider mb-1">Quality Score</div>
            <div className="text-sm text-text-muted">
              <span className="text-success font-semibold">{passed} passed</span>
              {' · '}
              <span className="text-red-400 font-semibold">{failed} failed</span>
              {errored > 0 && <>{' · '}<span className="text-amber-400 font-semibold">{errored} errored</span></>}
              <span className="text-text-muted/60"> of {perRule.length} rules</span>
            </div>
          </div>
        </div>
        {Object.keys(categoryScores).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {Object.entries(categoryScores).map(([cat, s]) => (
              <CategoryPill key={cat} label={cat} score={s} />
            ))}
          </div>
        )}
      </div>

      {/* Rule list */}
      <div className="space-y-2">
        {sortedRules.map(rule => <RuleCard key={rule.id} rule={rule} />)}
      </div>

      {/* AI summaries */}
      <ProseSection title="Validation Analysis" body={session?.validation_summary ?? ''} />
      <ProseSection title="Anomaly Analysis" body={session?.anomaly_summary ?? ''} />
    </div>
  )
}
