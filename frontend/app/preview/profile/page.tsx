'use client'
import { useState } from 'react'
import { ProfileStage } from '@/components/stages/ProfileStage'
import type { SessionState } from '@/lib/types'

type ScenarioKey =
  | 'ready'
  | 'loading'
  | 'no-alerts'
  | 'low-completeness'
  | 'readonly'

interface Scenario {
  key: ScenarioKey
  label: string
  description: string
  session: SessionState
  readOnly?: boolean
}

const READY_AI =
  'A loan-origination dataset (18,432 rows, 47 columns) covering applications from 2023-2025. Strong coverage on identifiers and amounts, but `email` and `co_signer_ssn` show notable missingness (6.7% and 41% respectively). Six items flagged for follow-up below.'

const READY_ALERTS = [
  {
    column: 'co_signer_ssn',
    type: 'Missing',
    description:
      '7,617 (41%) values missing — column may be optional for non-cosigned loans.',
  },
  {
    column: 'email',
    type: 'Missing',
    description: '1,243 (6.7%) values missing across application channels.',
  },
  {
    column: 'tenure',
    type: 'High Cardinality',
    description: '18,432 unique values (100% distinct) — likely an identifier.',
  },
  {
    column: 'state_code',
    type: 'Constant',
    description:
      'Only 1 unique value detected — verify if this dataset is single-state.',
  },
  {
    column: 'loan_amount',
    type: 'Skewness',
    description: 'Highly right-skewed (skew = 4.7) — long tail of large loans.',
  },
  {
    type: 'Duplicates',
    description:
      '42 duplicate rows detected — possible data entry errors at intake.',
  },
]

function makeSession(overrides: Partial<{ ai_summary: string; profile: Record<string, unknown> }>): SessionState {
  return {
    session_id: 'preview',
    stage: 'PROFILING',
    profile: {
      table: { n_rows: 18432, n_columns: 47, p_cells_missing: 0.07 },
      alerts: [],
    },
    ai_summary: '',
    suggested_rules: [],
    baseline_quality_score: 0,
    current_score: 0,
    validation_summary: '',
    anomaly_summary: '',
    transformation_log: [],
    scorecard: {},
    narrative: '',
    output_dir: '',
    zip_path: '',
    ...overrides,
  } as unknown as SessionState
}

const SCENARIOS: Scenario[] = [
  {
    key: 'ready',
    label: 'Default',
    description:
      'Populated AI summary + 6 alerts covering all three chip buckets.',
    session: makeSession({
      ai_summary: READY_AI,
      profile: {
        table: { n_rows: 18432, n_columns: 47, p_cells_missing: 0.07 },
        alerts: READY_ALERTS,
      },
    }),
  },
  {
    key: 'loading',
    label: 'AI analyzing',
    description:
      'Stats grid populated but the AI summary is still being written. Loading card with brand-primary spinner.',
    session: makeSession({
      profile: {
        table: { n_rows: 18432, n_columns: 47, p_cells_missing: 0.07 },
        alerts: [],
      },
    }),
  },
  {
    key: 'no-alerts',
    label: 'No alerts',
    description:
      'Clean dataset — alerts list is hidden entirely and the Continue button sits right under the stats grid.',
    session: makeSession({
      ai_summary:
        'A clean reference dataset (1,234 rows, 12 columns). All columns have full coverage and no structural alerts.',
      profile: {
        table: { n_rows: 1234, n_columns: 12, p_cells_missing: 0 },
        alerts: [],
      },
    }),
  },
  {
    key: 'low-completeness',
    label: 'Low completeness',
    description:
      'Completeness < 90% — the Completeness tile and its progress bar switch to warning-deep amber.',
    session: makeSession({
      ai_summary:
        'A sparse dataset with significant missingness — 32% of cells are empty. Investigation needed before rule generation.',
      profile: {
        table: { n_rows: 5000, n_columns: 20, p_cells_missing: 0.32 },
        alerts: READY_ALERTS.slice(0, 4),
      },
    }),
  },
  {
    key: 'readonly',
    label: 'Read-only (snapshot)',
    description:
      'Same as Default but readOnly=true — the Continue button is hidden (matches how SnapshotStageView mounts it).',
    session: makeSession({
      ai_summary: READY_AI,
      profile: {
        table: { n_rows: 18432, n_columns: 47, p_cells_missing: 0.07 },
        alerts: READY_ALERTS,
      },
    }),
    readOnly: true,
  },
]

export default function PreviewProfilePage() {
  const [activeKey, setActiveKey] = useState<ScenarioKey>('ready')
  const [showBanner, setShowBanner] = useState(true)
  const active = SCENARIOS.find((s) => s.key === activeKey) ?? SCENARIOS[0]

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {showBanner && (
        <div className="bg-warning/15 text-warning-deep text-xs px-4 py-2 flex items-center gap-3 border-b border-warning/30">
          <span className="font-semibold">PREVIEW</span>
          <span>Mock data — Continue is inert. {active.description}</span>
          <span className="flex-1" />
          <button
            onClick={() => setShowBanner(false)}
            className="hover:underline"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="px-6 py-3 border-b border-border bg-surface flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Scenario:
        </span>
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActiveKey(s.key)}
            className={[
              'text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors',
              activeKey === s.key
                ? 'bg-brand-accent text-on-brand'
                : 'bg-surface border border-border text-fg-muted hover:bg-elevated hover:text-fg',
            ].join(' ')}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <ProfileStage
            session={active.session}
            onContinue={() =>
              alert(
                'In the real app, this would advance the workflow to the Rules stage.',
              )
            }
            readOnly={active.readOnly}
          />
        </div>
      </div>
    </div>
  )
}
