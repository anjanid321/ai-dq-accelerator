'use client'

// Temporary preview route for the Rules stage redesign smoke test.
// NOT linked from the app. Delete before tagging rules-stage-v1.
//
// Renders the full workspace chrome (TopBar + Stepper + Main + AIPanel)
// with mock session data so the entire layout can be reviewed, not just
// the Rules stage content.

import { useState } from 'react'
import type { SessionState, Rule } from '@/lib/types'
import type { AIEvent } from '@/hooks/useAIStream'
import { TopBar } from '@/components/workspace/TopBar'
import { Stepper, type StageId } from '@/components/workspace/Stepper'
import { AIPanel } from '@/components/ai-panel/AIPanel'
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
  profile: { table: { n_rows: 18432, n_columns: 47 } } as Record<string, unknown>,
  ai_summary: '',
  suggested_rules: rules,
  baseline_quality_score: 0.72,
  current_score: 0.87,
  validation_summary: '',
  anomaly_summary: '',
  transformation_log: [],
  scorecard: {},
  narrative: '',
  output_dir: '',
  zip_path: '',
}

// Stepper: Rules is active; Load + Profile + Explore are done; the rest locked.
const STEPPER_COMPLETED: StageId[] = ['load', 'profile', 'explore']
const STEPPER_ACTIVE: StageId = 'rules'
const SUB_STATUS = 'Awaiting rule decisions'

const MOCK_EVENTS: AIEvent[] = [
  {
    event: 'tool_call',
    tool: 'analyze_rule_set',
    input: { rules: 6, dimensions: ['validity', 'completeness', 'uniqueness', 'consistency'] },
    ts: Date.now() - 60_000,
  } as unknown as AIEvent,
  {
    event: 'tool_result',
    tool: 'analyze_rule_set',
    preview: 'Suggested 6 rules covering 4 dimensions. No contradictions detected. Two completeness checks on adjacent date fields.',
    ts: Date.now() - 45_000,
  } as unknown as AIEvent,
  {
    event: 'thinking',
    content: 'The FICO range looks tight (300-850 is the canonical range, but origination data sometimes has 0s for unscorable applicants). Flagging in the rationale.',
    ts: Date.now() - 30_000,
  } as unknown as AIEvent,
  {
    event: 'done',
    ts: Date.now() - 15_000,
  } as unknown as AIEvent,
]

export default function RulesPreviewPage() {
  const [viewingStage, setViewingStage] = useState<StageId>(STEPPER_ACTIVE)

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 bg-elevated border-b border-border text-[11px] text-fg-muted shrink-0">
        Preview route · mock session · not linked from app · delete before tagging rules-stage-v1
      </div>

      <TopBar
        filename="loans-fy2025.csv"
        rowCount={18432}
        colCount={47}
        currentScore={session.current_score}
      />

      <div className="flex flex-1 overflow-hidden">
        <Stepper
          activeStage={STEPPER_ACTIVE}
          completedStages={STEPPER_COMPLETED}
          viewingStage={viewingStage}
          onStageClick={setViewingStage}
          activeSubStatus={SUB_STATUS}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <RulesStage session={session} />
          </div>
        </div>

        <AIPanel
          events={MOCK_EVENTS}
          isStreaming={false}
          waitingMessage={SUB_STATUS}
        />
      </div>
    </div>
  )
}
