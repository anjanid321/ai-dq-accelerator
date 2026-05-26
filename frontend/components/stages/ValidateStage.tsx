// frontend/components/stages/ValidateStage.tsx
'use client'
import { ArrowRight } from 'lucide-react'
import type { SessionState, PerRuleResult } from '@/lib/types'
import { Chip, type StatusTone } from '@/components/ui/Chip'

interface Props {
  session: SessionState | null
  readOnly?: boolean
  /**
   * When provided (and !readOnly), renders a "Continue to Triage" CTA at the
   * bottom of the stage. The live app's backend auto-transitions VALIDATING →
   * TRIAGING without user input, so the live page can omit this prop. The
   * /demo route wires it to navigate the walkthrough.
   */
  onContinue?: () => void
}

function CategoryPill({ label, score }: { label: string; score: number }) {
  return (
    <Chip variant="neutral" value={`${Math.round(score * 100)}%`}>
      <span className="capitalize">{label}</span>
    </Chip>
  )
}

function SampleRows({
  rows,
  targetColumn,
}: {
  rows: Record<string, unknown>[]
  targetColumn?: string
}) {
  if (!rows.length) return null
  const allKeys = Object.keys(rows[0])
  const keys =
    targetColumn && allKeys.includes(targetColumn)
      ? [targetColumn, ...allKeys.filter((k) => k !== targetColumn).slice(0, 2)]
      : allKeys.slice(0, 3)

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {keys.map((k) => (
              <th
                key={k}
                className="text-left px-2 py-1 text-fg-muted font-medium border-b border-border"
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 3).map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {keys.map((k) => (
                <td
                  key={k}
                  className="px-2 py-1 text-fg-muted font-mono truncate max-w-[160px]"
                >
                  {row[k] === null || row[k] === undefined ? (
                    <span className="italic text-fg-subtle">null</span>
                  ) : (
                    String(row[k])
                  )}
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

  // Card chrome matches the Rules-stage approved/denied pattern: full border
  // + soft ring glow keyed to the result tone. Replaces the previous
  // single-side `border-l-{tone}-deep` accent for visual consistency.
  const cardChrome = hasError
    ? 'border-warning ring-1 ring-warning/40'
    : failed
      ? 'border-danger ring-1 ring-danger/40'
      : 'border-success ring-1 ring-success/40'

  const resultTone: StatusTone = hasError ? 'warning' : failed ? 'danger' : 'success'
  const resultLabel = hasError
    ? 'Eval Error'
    : failed
      ? `Failed · ${rule.failure_count}`
      : 'Passed'

  return (
    <div
      className={`bg-surface border rounded-lg p-3 ${cardChrome}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-fg truncate">
            {rule.column ?? 'table-level'}
          </span>
          <span className="text-xs text-fg-subtle font-mono">{rule.check}</span>
          {rule.rationale && (
            <span className="text-xs text-fg-muted leading-snug">{rule.rationale}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {failed && (
            <span className="text-xs text-fg-muted">
              {(rule.failure_rate * 100).toFixed(1)}% of rows
            </span>
          )}
          <Chip variant="status" tone={resultTone}>{resultLabel}</Chip>
        </div>
      </div>
      {hasError && (
        <div className="mt-2 rounded-md bg-warning/15 border border-warning/30 px-2 py-1.5 text-xs font-mono text-warning-deep break-all">
          {rule.error}
        </div>
      )}
      {!hasError && failed && rule.sample_failing_rows.length > 0 && (
        <SampleRows rows={rule.sample_failing_rows} targetColumn={rule.column ?? undefined} />
      )}
    </div>
  )
}

function ProseSection({ label, body }: { label: string; body: string }) {
  if (!body) return null
  return (
    <div className="bg-accent-purple/15 border border-accent-purple/30 rounded-xl p-4 flex flex-col gap-1.5">
      <div className="text-xs font-semibold uppercase tracking-widest text-accent-purple-deep">
        {label}
      </div>
      <p className="text-xs text-accent-purple-deep leading-relaxed whitespace-pre-wrap">
        {body}
      </p>
    </div>
  )
}

export function ValidateStage({ session, readOnly, onContinue }: Props) {
  const results = session?.validation_results
  const perRule = results?.per_rule

  if (!perRule?.length) {
    return (
      <div className="p-5">
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-3">
          <div
            role="status"
            aria-label="Validating"
            className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin shrink-0"
          />
          <span className="text-xs text-fg-muted">
            AI is running validation rules against your dataset…
          </span>
        </div>
      </div>
    )
  }

  const score = session?.current_score ?? session?.baseline_quality_score ?? 0
  const baseline = session?.baseline_quality_score ?? 0
  const passedRules = perRule.filter((r) => r.passed && !r.error)
  const failedRules = perRule
    .filter((r) => !r.passed && !r.error)
    .sort((a, b) => b.failure_count - a.failure_count)
  const erroredRules = perRule.filter((r) => !!r.error)
  const passed = passedRules.length
  const failed = failedRules.length
  const errored = erroredRules.length
  const categoryScores = results?.category_scores ?? {}

  const showContinue = !readOnly && !!onContinue

  return (
    <div className="p-5 flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Validation Results</h1>
        <p className="text-xs text-fg-muted">
          How your dataset performs against the proposed rules.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-5xl font-bold text-fg">
              {Math.round(score * 100)}
              <span className="text-2xl text-fg-muted">%</span>
            </div>
            {score !== baseline && (
              <div className="text-xs text-fg-subtle mt-1">
                baseline: {Math.round(baseline * 100)}%
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
              Quality Score
            </div>
            <div className="text-sm text-fg-muted">
              <span className="text-success-deep font-semibold">{passed} passed</span>
              {' · '}
              <span className="text-danger-deep font-semibold">{failed} failed</span>
              {errored > 0 && (
                <>
                  {' · '}
                  <span className="text-warning-deep font-semibold">{errored} errored</span>
                </>
              )}
              <span className="text-fg-subtle"> of {perRule.length} rules</span>
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

      <ProseSection label="✦ VALIDATION ANALYSIS" body={session?.validation_summary ?? ''} />
      <ProseSection label="✦ ANOMALY ANALYSIS" body={session?.anomaly_summary ?? ''} />

      {passed > 0 && (
        <section data-testid="passed-section" className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Passed Rules <span className="text-fg-subtle">· {passed}</span>
          </div>
          {passedRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </section>
      )}

      {failed > 0 && (
        <section data-testid="failed-section" className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Failed Rules <span className="text-fg-subtle">· {failed}</span>
          </div>
          {failedRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </section>
      )}

      {errored > 0 && (
        <section data-testid="errored-section" className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Errored Rules <span className="text-fg-subtle">· {errored}</span>
          </div>
          {erroredRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </section>
      )}

      {showContinue && (
        <div className="flex justify-end mt-2">
          <button
            type="button"
            onClick={onContinue}
            data-testid="validate-continue"
            className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
          >
            Continue to Triage
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  )
}
