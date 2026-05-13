'use client'
import { useState } from 'react'
import type { WorkflowStage, TargetEnv } from '@/lib/types'
import { generatePipeline, getPipelineDownloadUrl } from '@/lib/api'

const ARTIFACTS = [
  { icon: '📦', name: 'dbt Models', desc: 'SQL transform models matching your approved transforms' },
  { icon: '🔍', name: 'SodaCL checks.yml', desc: 'Quality rules from your approved checks' },
  { icon: '🚁', name: 'Airflow DAG', desc: 'Orchestration DAG wiring dbt + Soda end-to-end' },
  { icon: '📄', name: 'Data Contract', desc: 'YAML schema and quality contract for downstream consumers' },
  { icon: '📊', name: 'Quality Report', desc: 'HTML scorecard with full transformation history' },
  { icon: '🗄️', name: 'cleaned_data.parquet', desc: 'Cleaned dataset ready for immediate use' },
]

interface Props { sessionId: string; stage: WorkflowStage; readOnly?: boolean }

export function PipelineStage({ sessionId, stage, readOnly }: Props) {
  const [env, setEnv] = useState<TargetEnv>({ warehouse: 'duckdb', orchestrator: 'airflow', python_version: '3.11', schedule: '@daily', slack_channel: '' })
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const done = stage === 'COMPLETE'
  const generatingNow = stage === 'GENERATING'

  function update(key: keyof TargetEnv, value: string) {
    setEnv(prev => ({ ...prev, [key]: value }))
  }

  async function handleGenerate() {
    setGenerating(true)
    setError('')
    try {
      await generatePipeline(sessionId, { ...env, slack_channel: env.slack_channel || undefined })
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="p-5">
      <h1 className="text-base font-bold text-text-primary mb-1">Generate Pipeline</h1>
      <p className="text-xs text-text-muted mb-4">Configure your target environment and generate a production-ready data quality pipeline.</p>

      {/* Config form */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-surface border border-border rounded-lg p-3">
          <label className="text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">Warehouse</label>
          <select className="w-full bg-bg border border-border text-text-primary rounded-md px-2.5 py-1.5 text-xs outline-none" value={env.warehouse} onChange={e => update('warehouse', e.target.value)}>
            {['snowflake', 'postgres', 'bigquery', 'duckdb'].map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <label className="text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">Orchestrator</label>
          <select className="w-full bg-bg border border-border text-text-primary rounded-md px-2.5 py-1.5 text-xs outline-none" value={env.orchestrator} disabled>
            <option value="airflow">Airflow</option>
          </select>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <label className="text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">Schedule</label>
          <input className="w-full bg-bg border border-border text-text-primary rounded-md px-2.5 py-1.5 text-xs font-mono outline-none" value={env.schedule} onChange={e => update('schedule', e.target.value)} />
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <label className="text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">Python Version</label>
          <input className="w-full bg-bg border border-border text-text-primary rounded-md px-2.5 py-1.5 text-xs font-mono outline-none" value={env.python_version} onChange={e => update('python_version', e.target.value)} />
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">Slack Channel (optional)</label>
          <input className="w-full bg-bg border border-border text-text-primary rounded-md px-2.5 py-1.5 text-xs font-mono outline-none" placeholder="#data-quality-alerts" value={env.slack_channel ?? ''} onChange={e => update('slack_channel', e.target.value)} />
        </div>
      </div>

      {/* Artifacts */}
      <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">What gets generated</div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {ARTIFACTS.map(a => (
          <div key={a.name} className="bg-surface border border-border rounded-xl p-3.5">
            <div className="text-xl mb-2">{a.icon}</div>
            <div className="text-xs font-semibold text-text-primary mb-1">{a.name}</div>
            <div className="text-[11px] text-text-muted leading-relaxed">{a.desc}</div>
          </div>
        ))}
      </div>

      {error && <div className="text-danger-light text-xs mb-3">{error}</div>}

      {/* CTA */}
      {!readOnly && <div className="flex gap-3">
        {done ? (
          <>
            <button className="flex-1 bg-success text-black font-semibold text-sm py-3 rounded-xl cursor-default flex items-center justify-center gap-2">
              ✓ Pipeline Generated — Ready to Download
            </button>
            <a href={getPipelineDownloadUrl(sessionId)} download className="bg-surface border border-indigo/40 text-indigo-light text-sm font-medium px-5 py-3 rounded-xl hover:bg-indigo/10">
              ↓ Download ZIP
            </a>
          </>
        ) : generatingNow ? (
          <button className="flex-1 bg-indigo/50 text-white text-sm font-medium py-3 rounded-xl flex items-center justify-center gap-2 cursor-default" disabled>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Generating your pipeline...
          </button>
        ) : (
          <button className="flex-1 bg-indigo text-white font-semibold text-sm py-3 rounded-xl disabled:opacity-40" disabled={generating} onClick={handleGenerate}>
            {generating ? 'Starting...' : 'Generate Pipeline →'}
          </button>
        )}
      </div>}
    </div>
  )
}
