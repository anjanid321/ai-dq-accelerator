// frontend/app/demo/_fixtures/mock-session.ts
//
// Frozen fixtures used by the /demo route to render the Round-2 redesigned
// stages (Load, Profile, Explore, Rules, Validate) without a backend. The
// data is engineered to be visually rich enough to exercise every chip
// palette and decision affordance the designs introduce.

import type {
  SessionState,
  Rule,
  SessionListEntry,
  PerRuleResult,
  ValidationResults,
  TriageResult,
  TriageClassification,
} from '@/lib/types'
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

// Validation results mirror the engineered anomalies in
// samples/loan_applications.csv so the pass/fail mix reads true to life.
const DEMO_PER_RULE: PerRuleResult[] = [
  {
    id: 'r1',
    category: 'uniqueness',
    column: 'application_id',
    check: 'unique',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'application_id is 100% distinct in profiling — enforce uniqueness so future inserts can\'t collide.',
  },
  {
    id: 'r2',
    category: 'completeness',
    column: 'applicant_name',
    check: 'not_null',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'applicant_name is 0% missing today — pin completeness at 100%.',
  },
  {
    id: 'r3',
    category: 'completeness',
    column: 'state_code',
    check: 'not_null',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'state_code is 0% missing and constant — enforce completeness.',
  },
  {
    id: 'r4',
    category: 'validity',
    column: 'credit_score',
    check: 'range(300, 850)',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'FICO scores fall in 300–850. Tolerate 1% out-of-range for legacy data import errors.',
  },
  {
    id: 'r5',
    category: 'validity',
    column: 'application_date',
    check: 'max_date(today)',
    passed: false,
    failure_count: 3,
    failure_rate: 0.015,
    sample_failing_rows: [
      { application_id: 'LA-000017', application_date: '2030-04-15', credit_score: 720 },
      { application_id: 'LA-000089', application_date: '2030-08-02', credit_score: 685 },
      { application_id: 'LA-000142', application_date: '2030-12-21', credit_score: 740 },
    ],
    rationale: 'application_date should never be in the future. 3 rows fail this and need to be clipped.',
  },
  {
    id: 'r6',
    category: 'validity',
    column: 'email',
    check: 'regex(email)',
    passed: false,
    failure_count: 6,
    failure_rate: 0.03,
    sample_failing_rows: [
      { application_id: 'LA-000005', email: 'maria.gonzalez.invalid', applicant_name: 'Maria Gonzalez' },
      { application_id: 'LA-000031', email: 'jin.park.invalid', applicant_name: 'Jin Park' },
      { application_id: 'LA-000077', email: 'thandiwe.mokoena.invalid', applicant_name: 'Thandiwe Mokoena' },
    ],
    rationale: '6 rows fail standard email format. Tolerate 5% to leave room for missing values.',
  },
  {
    id: 'r7',
    category: 'consistency',
    column: 'phone',
    check: 'format((XXX) XXX-XXXX)',
    passed: false,
    failure_count: 152,
    failure_rate: 0.76,
    sample_failing_rows: [
      { application_id: 'LA-000003', phone: '7035551234', applicant_name: 'Ahmed Hassan' },
      { application_id: 'LA-000011', phone: '703.555.4821', applicant_name: 'Priya Patel' },
      { application_id: 'LA-000024', phone: '+1-703-555-9912', applicant_name: 'Carlos Rivera' },
    ],
    rationale: 'phone shows 5 different formats. Normalize toward (XXX) XXX-XXXX before re-validating.',
  },
  {
    id: 'r8',
    category: 'validity',
    column: 'loan_status',
    check: 'in([APPROVED, REJECTED, PENDING])',
    passed: true,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'loan_status has 3 distinct values today — pin the allowed set.',
  },
  {
    id: 'r9-eval',
    category: 'consistency',
    column: 'co_signer_ssn',
    check: 'custom_code(format_check)',
    passed: false,
    failure_count: 0,
    failure_rate: 0,
    sample_failing_rows: [],
    rationale: 'Custom SSN-format check; failed to compile against the sandboxed environment.',
    error: "NameError: name 're' is not defined (sandbox blocks the `re` import — rewrite without regex).",
  },
]

const DEMO_VALIDATION_RESULTS: ValidationResults = {
  per_rule: DEMO_PER_RULE,
  category_scores: {
    completeness: 1.0,
    uniqueness: 1.0,
    validity: 0.78,
    consistency: 0.5,
  },
  baseline_quality_score: 0.78,
}

export const DEMO_VALIDATE_SESSION: SessionState = {
  ...baseSession('VALIDATING'),
  ai_summary: DEMO_AI_SUMMARY,
  suggested_rules: DEMO_RULES,
  baseline_quality_score: 0.78,
  current_score: 0.82,
  validation_summary:
    'The dataset clears the structural rules — application_id is unique, completeness on applicant_name and state_code is at 100%, and loan_status falls in the allowed value set. Failures cluster on format consistency: phone shows five different formats (76% of rows), email has 6 malformed values, and 3 application_date entries are in the future. One custom rule failed to evaluate in the sandbox.',
  anomaly_summary:
    'Two applications with credit_score < 600 are marked APPROVED — worth surfacing to the underwriter before the rules pipeline locks in. The cross-column pattern is unusual enough to be either an exception path or an intake mistake, not a data-quality issue per se.',
  validation_results: DEMO_VALIDATION_RESULTS,
}

// Triage fixture exercises all four classifications + a mix of confidences.
// Mirrors the failing rules from DEMO_VALIDATE_SESSION (phone-format,
// email-regex, future application_date, the sandboxed custom rule, plus
// two synthetic threshold_too_strict / unfixable entries to round out
// the four-classification coverage).
const DEMO_TRIAGE_CLASSIFICATIONS: TriageClassification[] = [
  {
    rule_id: 'r6',
    check: 'regex(email)',
    column: 'email',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.97,
    proposed_remove: false,
    reason:
      '6 of 200 emails fail strict RFC 5322 regex but match a relaxed pattern. Raising the threshold from 95% to 97% would let these pass without dropping data quality.',
    confidence: 'high',
  },
  {
    rule_id: 'r5',
    check: 'max_date(today)',
    column: 'application_date',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.99,
    proposed_remove: false,
    reason:
      '3 application dates are in the future, likely typos. The AI suggests accepting these as outliers via a 99% threshold rather than blocking the pipeline.',
    confidence: 'medium',
  },
  {
    rule_id: 'r7',
    check: 'format((XXX) XXX-XXXX)',
    column: 'phone',
    classification: 'transform_fixable',
    proposed_threshold: undefined,
    proposed_remove: false,
    reason:
      '152 phone numbers fail the strict format check, but each row matches one of 5 alternate formats. A normalization transform can fix every row automatically — no rule change needed.',
    confidence: 'high',
  },
  {
    rule_id: 'r9-eval',
    check: 'custom_code(format_check)',
    column: 'co_signer_ssn',
    classification: 'eval_error',
    proposed_threshold: undefined,
    proposed_remove: true,
    reason:
      'Custom SSN-format check failed to compile against the sandboxed environment (NameError on `re` import). The rule cannot be evaluated and must be rewritten or removed.',
    confidence: 'medium',
  },
  {
    rule_id: 'r10-synth',
    check: 'not_null',
    column: 'co_signer_phone',
    classification: 'unfixable',
    proposed_threshold: undefined,
    proposed_remove: true,
    reason:
      'co_signer_phone is null in 87% of rows because most loans don\'t have co-signers. The column is correctly missing — this is not a data quality issue.',
    confidence: 'high',
  },
  {
    rule_id: 'r11-synth',
    check: 'unique',
    column: 'middle_initial',
    classification: 'unfixable',
    proposed_threshold: undefined,
    proposed_remove: true,
    reason:
      'middle_initial is intentionally non-unique (1-letter values repeat naturally). The uniqueness rule was inferred incorrectly during profiling.',
    confidence: 'high',
  },
  {
    rule_id: 'r12-synth',
    check: 'range(300, 850)',
    column: 'credit_score',
    classification: 'threshold_too_strict',
    proposed_threshold: 0.995,
    proposed_remove: false,
    reason:
      '1 legacy row has credit_score=0 from a pre-FICO import. Accepting at 99.5% tolerance keeps the rule strict for new data while letting the historical row through.',
    confidence: 'low',
  },
  {
    rule_id: 'r13-synth',
    check: 'custom_code(domain_check)',
    column: 'employer_domain',
    classification: 'transform_fixable',
    proposed_threshold: undefined,
    proposed_remove: false,
    reason:
      'employer_domain values include both bare hostnames ("ibm.com") and protocol-prefixed URLs ("https://ibm.com"). A normalization step can canonicalize them automatically.',
    confidence: 'high',
  },
]

const DEMO_TRIAGE_RESULT: TriageResult = {
  classifications: DEMO_TRIAGE_CLASSIFICATIONS,
  summary: {
    transform_fixable: 2,
    threshold_too_strict: 3,
    unfixable: 2,
    eval_error: 1,
  },
}

export const DEMO_TRIAGE_SESSION: SessionState = {
  ...baseSession('AWAITING_TRIAGE_APPROVAL'),
  ai_summary: DEMO_AI_SUMMARY,
  suggested_rules: DEMO_RULES,
  baseline_quality_score: 0.78,
  current_score: 0.82,
  validation_summary: DEMO_VALIDATE_SESSION.validation_summary,
  anomaly_summary: DEMO_VALIDATE_SESSION.anomaly_summary,
  validation_results: DEMO_VALIDATION_RESULTS,
  triage_result: DEMO_TRIAGE_RESULT,
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

// Sessions list — 4 entries covering the chip palettes shown by SessionCard:
// awaiting (warning), progress (info), complete (success). The first entry is
// the same session the rest of the demo walks through.
export const DEMO_SESSIONS_LIST: SessionListEntry[] = [
  {
    id: 'demo',
    filename: 'loan_applications.csv',
    stage: 'AWAITING_RULE_APPROVAL',
    current_score: 0.78,
    baseline_score: 0.78,
    created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(), // 12 min ago
    updated_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
  },
  {
    id: 'demo-2',
    filename: 'q1_customer_signups.csv',
    stage: 'AWAITING_INVESTIGATION_REVIEW',
    current_score: 0.81,
    baseline_score: 0.81,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), // 3h ago
    updated_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
  },
  {
    id: 'demo-3',
    filename: 'inventory_snapshot_2026_q1.parquet',
    stage: 'TRANSFORMATION_LOOP',
    current_score: 0.84,
    baseline_score: 0.71,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(), // ~28h ago
    updated_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    id: 'demo-4',
    filename: 'lender_pipeline_2025_run.csv',
    stage: 'COMPLETE',
    current_score: 0.94,
    baseline_score: 0.66,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(), // 5 days ago
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
  },
]

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
