// frontend/app/demo/_fixtures/mock-session.ts
//
// Frozen fixtures used by the /demo route to render the 4 Round-2 redesigned
// stages (Load, Profile, Explore, Rules) without a backend. The data is
// engineered to be visually rich enough to exercise every chip palette and
// decision affordance the designs introduce.

import type { SessionState, Rule } from '@/lib/types'
import type { AIEvent } from '@/hooks/useAIStream'
import type { ExplorationState } from '@/components/stages/ExplorationStage'

export const DEMO_FILENAME = 'loan_applications.csv'

export const DEMO_AI_SUMMARY =
  'A loan-origination dataset (200 rows, 12 columns) covering applications across Virginia. Strong coverage on identifiers and amounts, but `email`, `co_signer_ssn`, and `notes` show notable missingness (7%, 41%, and 85% respectively). 8 items flagged for follow-up below, including 2 applications with credit scores below 600 that were marked APPROVED — worth a closer look.'

export const DEMO_PROFILE_ALERTS = [
  {
    column: 'co_signer_ssn',
    type: 'Missing',
    description: '82 (41%) values missing — column may be optional for non-cosigned loans.',
  },
  {
    column: 'email',
    type: 'Missing',
    description: '14 (7%) values missing across application channels.',
  },
  {
    column: 'notes',
    type: 'Missing',
    description: '170 (85%) values missing — free-text capture is rare.',
  },
  {
    column: 'state_code',
    type: 'Constant',
    description: 'Only 1 unique value detected (`VA`) — verify if this dataset is single-state by design.',
  },
  {
    column: 'application_id',
    type: 'High Cardinality',
    description: '200 unique values (100% distinct) — likely the primary key.',
  },
  {
    column: 'loan_amount',
    type: 'Skewness',
    description: 'Highly right-skewed (skew = 5.2) — 5 outliers above $500,000 against a $5k–$50k baseline.',
  },
  {
    type: 'Duplicates',
    description: '8 rows duplicated across 4 (applicant_name, email) pairs — possible re-applications.',
  },
  {
    column: 'email',
    type: 'Type Mismatch',
    description: '6 values fail email regex (missing `@`) — drop or null before validation.',
  },
]

export const DEMO_PROFILE_TABLE = {
  n_rows: 200,
  n_columns: 12,
  p_cells_missing: 0.12,
}

export const DEMO_RULES: Rule[] = [
  {
    id: 'r1',
    category: 'uniqueness',
    column: 'application_id',
    check: 'unique',
    threshold: 1.0,
    rationale: 'application_id is 100% distinct in profiling — enforce uniqueness so future inserts can\'t collide.',
    modified: false,
  },
  {
    id: 'r2',
    category: 'completeness',
    column: 'applicant_name',
    check: 'not_null',
    threshold: 1.0,
    rationale: 'applicant_name is 0% missing today — pin completeness at 100%.',
    modified: false,
  },
  {
    id: 'r3',
    category: 'completeness',
    column: 'state_code',
    check: 'not_null',
    threshold: 1.0,
    rationale: 'state_code is 0% missing and constant — enforce completeness.',
    modified: false,
  },
  {
    id: 'r4',
    category: 'validity',
    column: 'credit_score',
    check: 'range',
    min: 300,
    max: 850,
    threshold: 0.99,
    rationale: 'FICO scores fall in 300–850. Tolerate 1% out-of-range for legacy data import errors.',
    modified: false,
  },
  {
    id: 'r5',
    category: 'validity',
    column: 'application_date',
    check: 'range',
    max: 2026,
    threshold: 1.0,
    rationale: 'application_date should never be in the future. 3 rows currently fail this and need to be clipped.',
    modified: false,
  },
  {
    id: 'r6',
    category: 'validity',
    column: 'email',
    check: 'regex',
    pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    threshold: 0.95,
    rationale: '6 rows fail standard email format. Tolerate 5% to leave room for missing values.',
    modified: false,
  },
  {
    id: 'r7',
    category: 'consistency',
    column: 'phone',
    check: 'format',
    format: '(XXX) XXX-XXXX',
    threshold: 0.9,
    rationale: 'phone shows 5 different formats. Normalize toward (XXX) XXX-XXXX before re-validating.',
    modified: false,
  },
  {
    id: 'r8',
    category: 'validity',
    column: 'loan_status',
    check: 'value_set',
    values: ['APPROVED', 'REJECTED', 'PENDING'],
    threshold: 1.0,
    rationale: 'loan_status has 3 distinct values today — pin the allowed set.',
    modified: false,
  },
]

function baseSession(stage: SessionState['stage']): SessionState {
  return {
    session_id: 'demo',
    stage,
    profile: {
      table: DEMO_PROFILE_TABLE,
      alerts: DEMO_PROFILE_ALERTS,
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
  }
}

export const DEMO_PROFILE_SESSION: SessionState = {
  ...baseSession('PROFILING'),
  ai_summary: DEMO_AI_SUMMARY,
}

export const DEMO_RULES_SESSION: SessionState = {
  ...baseSession('AWAITING_RULE_APPROVAL'),
  ai_summary: DEMO_AI_SUMMARY,
  suggested_rules: DEMO_RULES,
  baseline_quality_score: 0.78,
  current_score: 0.78,
}

export const DEMO_EXPLORE_STATE: ExplorationState = {
  exploration_findings: {},
  open_questions: [
    'Two applications show `credit_score` < 600 AND `loan_status = APPROVED` — is this an exception path, or a data-entry error worth surfacing to the underwriter?',
    '`co_signer_ssn` is missing on 41% of rows. Are these single-applicant loans by design, or is the column being dropped during intake?',
    '`state_code` is `VA` on every row. Is this dataset single-state by design, or filtered upstream?',
  ],
  investigation_round: 0,
  notebook_ready: true,
  synthesis_constrained: false,
  synthesis_constraint_reasons: [],
}

export const DEMO_AI_EVENTS: AIEvent[] = [
  { event: 'thinking', ts: Date.now() - 30_000, text: 'Loading loan_applications.csv into a session DuckDB…' },
  { event: 'tool_call', ts: Date.now() - 28_000, name: 'profile_dataset', args: { session_id: 'demo' } },
  { event: 'tool_result', ts: Date.now() - 24_000, name: 'profile_dataset', summary: '200 rows × 12 columns. 8 alerts surfaced.' },
  { event: 'thinking', ts: Date.now() - 18_000, text: 'Reviewing alerts and drafting the AI summary…' },
  { event: 'thinking', ts: Date.now() - 12_000, text: 'Building exploration notebook with charts for skewed and constant columns…' },
  { event: 'tool_call', ts: Date.now() - 8_000, name: 'build_notebook', args: { session_id: 'demo' } },
  { event: 'tool_result', ts: Date.now() - 4_000, name: 'build_notebook', summary: 'Notebook ready. 3 open questions for the human.' },
  { event: 'done', ts: Date.now() - 2_000 },
]
