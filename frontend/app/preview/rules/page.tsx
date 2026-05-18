'use client'

// Temporary preview route for the Rules stage redesign smoke test.
// NOT linked from the app. Delete before tagging rules-stage-v1.

import type { SessionState, Rule } from '@/lib/types'
import { RulesStage } from '@/components/stages/RulesStage'

const rules: Rule[] = [
  {
    id: 'r1',
    category: 'validity',
    column: 'customer_email',
    check: 'customer_email matches email regex',
    pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    threshold: 1,
    modified: false,
    rationale: 'Email addresses should follow standard RFC 5322 format to support delivery.',
  },
  {
    id: 'r2',
    category: 'completeness',
    column: 'loan_amount',
    check: 'loan_amount IS NOT NULL',
    threshold: 1,
    modified: false,
    rationale: 'Loan amount is required for downstream pricing calculations.',
  },
  {
    id: 'r3',
    category: 'completeness',
    column: 'origination_date',
    check: 'origination_date IS NOT NULL',
    threshold: 1,
    modified: false,
    rationale: 'Origination date drives the monthly cohort attribution.',
  },
  {
    id: 'r4',
    category: 'uniqueness',
    column: 'application_id',
    check: 'application_id is unique',
    threshold: 1,
    modified: false,
    rationale: 'Duplicate application ids would inflate funnel counts.',
  },
  {
    id: 'r5',
    category: 'validity',
    column: 'fico_score',
    check: 'fico_score between min and max',
    min: 300,
    max: 850,
    threshold: 0.99,
    modified: false,
    rationale: 'FICO scores outside 300–850 indicate an upstream encoding error.',
  },
  {
    id: 'r6',
    category: 'consistency',
    col_a: 'state',
    col_b: 'zip_code',
    check: 'state matches zip_code prefix table',
    threshold: 0.95,
    modified: false,
    rationale: 'State and zip should agree per USPS reference; mismatches signal address entry errors.',
  },
]

const session: SessionState = {
  session_id: 'preview-rules-mock',
  stage: 'AWAITING_RULE_APPROVAL',
  profile: {},
  ai_summary: '',
  suggested_rules: rules,
  baseline_quality_score: 0.72,
  current_score: 0.72,
  validation_summary: '',
  anomaly_summary: '',
  transformation_log: [],
  scorecard: {},
  narrative: '',
  output_dir: '',
  zip_path: '',
}

export default function RulesPreviewPage() {
  return (
    <div className="h-screen flex flex-col bg-canvas">
      <div className="px-5 py-2 bg-elevated border-b border-border text-xs text-fg-muted">
        Preview route · mock session · not linked from app navigation · delete before tagging
      </div>
      <div className="flex-1 min-h-0">
        <RulesStage session={session} />
      </div>
    </div>
  )
}
