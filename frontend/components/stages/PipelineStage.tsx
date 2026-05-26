'use client'
import { useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ChevronDown,
  Database,
  Download,
  FileText,
  GitBranch,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { WorkflowStage, TargetEnv } from '@/lib/types'
import { generatePipeline, getPipelineDownloadUrl } from '@/lib/api'

const ARTIFACTS: { Icon: LucideIcon; name: string; desc: string }[] = [
  { Icon: Boxes, name: 'dbt Models', desc: 'SQL transform models matching your approved transforms' },
  { Icon: Search, name: 'SodaCL checks.yml', desc: 'Quality rules from your approved checks' },
  { Icon: GitBranch, name: 'Airflow DAG', desc: 'Orchestration DAG wiring dbt + Soda end-to-end' },
  { Icon: FileText, name: 'Data Contract', desc: 'YAML schema and quality contract for downstream consumers' },
  { Icon: BarChart3, name: 'Quality Report', desc: 'HTML scorecard with full transformation history' },
  { Icon: Database, name: 'cleaned_data.parquet', desc: 'Cleaned dataset ready for immediate use' },
]

interface Props {
  sessionId: string
  stage: WorkflowStage
  readOnly?: boolean
  demoMode?: boolean
}

type DemoStage = 'awaiting' | 'generating' | 'complete'

const FIELD_INPUT_CLASS =
  'w-full bg-surface border border-border-strong text-fg rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary'

// Wraps a <select> so the native browser caret is replaced with a Lucide
// ChevronDown positioned with right-3 — symmetric with the px-3 left text
// padding on FIELD_INPUT_CLASS.
function SelectField({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string
  onChange?: (v: string) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className={`${FIELD_INPUT_CLASS} appearance-none pr-9 disabled:opacity-70`}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={2}
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-fg-muted"
      />
    </div>
  )
}

export function PipelineStage({ sessionId, stage, readOnly, demoMode }: Props) {
  const [env, setEnv] = useState<TargetEnv>({
    warehouse: 'duckdb',
    orchestrator: 'airflow',
    python_version: '3.11',
    schedule: '@daily',
    slack_channel: '',
  })
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  // Initialize the demo state machine from the incoming stage so callers can
  // open Pipeline directly in 'complete' (download visible) state — used by
  // the demo's COMPLETE session card.
  const [demoStage, setDemoStage] = useState<DemoStage>(
    stage === 'COMPLETE' ? 'complete' : stage === 'GENERATING' ? 'generating' : 'awaiting',
  )

  const effectiveStage: WorkflowStage = demoMode
    ? demoStage === 'awaiting'
      ? 'AWAITING_PIPELINE_CONFIRMATION'
      : demoStage === 'generating'
        ? 'GENERATING'
        : 'COMPLETE'
    : stage

  const done = effectiveStage === 'COMPLETE'
  const generatingNow = effectiveStage === 'GENERATING'

  function update(key: keyof TargetEnv, value: string) {
    setEnv((prev) => ({ ...prev, [key]: value }))
  }

  async function handleGenerate() {
    setGenerating(true)
    setError('')
    try {
      if (demoMode) {
        setDemoStage('generating')
        await new Promise((r) => setTimeout(r, 800))
        setDemoStage('complete')
        return
      }
      await generatePipeline(sessionId, {
        ...env,
        slack_channel: env.slack_channel || undefined,
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  const downloadHref = demoMode ? '#' : getPipelineDownloadUrl(sessionId)

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-bold text-fg">Generate Pipeline</h1>
        <p className="text-xs text-fg-muted">
          Configure your target environment and generate a production-ready data quality pipeline.
        </p>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">
          Target Environment
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-surface border border-border rounded-lg p-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle block mb-1.5">
              Warehouse
            </label>
            <SelectField
              value={env.warehouse}
              onChange={(v) => update('warehouse', v)}
            >
              {['snowflake', 'postgres', 'bigquery', 'duckdb'].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="bg-surface border border-border rounded-lg p-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle block mb-1.5">
              Orchestrator
            </label>
            <SelectField value={env.orchestrator} disabled>
              <option value="airflow">Airflow</option>
            </SelectField>
          </div>
          <div className="bg-surface border border-border rounded-lg p-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle block mb-1.5">
              Schedule
            </label>
            <input
              className={`${FIELD_INPUT_CLASS} font-mono`}
              value={env.schedule}
              onChange={(e) => update('schedule', e.target.value)}
            />
          </div>
          <div className="bg-surface border border-border rounded-lg p-3">
            <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle block mb-1.5">
              Python Version
            </label>
            <input
              className={`${FIELD_INPUT_CLASS} font-mono`}
              value={env.python_version}
              onChange={(e) => update('python_version', e.target.value)}
            />
          </div>
          <div className="bg-surface border border-border rounded-lg p-3 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-widest text-fg-subtle block mb-1.5">
              Slack Channel (optional)
            </label>
            <input
              className={`${FIELD_INPUT_CLASS} font-mono`}
              placeholder="#data-quality-alerts"
              value={env.slack_channel ?? ''}
              onChange={(e) => update('slack_channel', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">
          What Gets Generated
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ARTIFACTS.map(({ Icon, name, desc }) => (
            <div key={name} className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-1.5">
              <div className="w-7 h-7 rounded-md bg-accent-indigo/15 text-accent-indigo-deep flex items-center justify-center">
                <Icon size={16} strokeWidth={2} />
              </div>
              <div className="text-xs font-semibold text-fg">{name}</div>
              <div className="text-xs text-fg-muted leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-danger/15 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger-deep">
          {error}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-3">
          {done ? (
            <>
              <div className="flex-1 min-w-[260px] bg-success/15 border border-success/30 text-success-deep text-sm font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2">
                <Check size={16} strokeWidth={2.5} />
                Pipeline Generated — Ready to Download
              </div>
              <a
                href={downloadHref}
                download
                className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-5 py-3 rounded-xl hover:bg-brand-accent/90 hover:shadow-md transition-all"
              >
                <Download size={14} strokeWidth={2} />
                Download ZIP
              </a>
            </>
          ) : generatingNow ? (
            <button
              type="button"
              disabled
              className="flex-1 inline-flex items-center justify-center gap-2 bg-brand-accent/60 text-on-brand text-[13px] font-semibold py-3 rounded-xl cursor-default"
            >
              <div
                role="status"
                aria-label="Generating"
                className="w-4 h-4 border-2 border-on-brand border-t-transparent rounded-full animate-spin"
              />
              Generating your pipeline…
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold py-3 rounded-xl hover:bg-brand-accent/90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {generating ? 'Starting…' : 'Generate Pipeline'}
              {!generating && <ArrowRight size={14} strokeWidth={2} />}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
