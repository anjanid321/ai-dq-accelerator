// frontend/lib/stages.ts
import type { WorkflowStage } from './types'

/**
 * Human-readable label for every backend stage. Used by the session card chip,
 * the workspace breadcrumb, and anywhere else a stage value reaches the UI.
 */
export const STAGE_LABELS: Record<WorkflowStage, string> = {
  LOADING: 'Loading',
  PROFILING: 'Profiling',
  AWAITING_INVESTIGATION_REVIEW: 'Reviewing Exploration',
  REINVESTIGATING: 'Investigating',
  PROFILING_SYNTHESIS: 'Synthesizing',
  RULE_REVIEW: 'Reviewing Rules',
  AWAITING_RULE_APPROVAL: 'Awaiting Rules',
  VALIDATING: 'Validating',
  TRIAGING: 'Triaging',
  AWAITING_TRIAGE_APPROVAL: 'Awaiting Triage',
  PLANNING: 'Planning',
  AWAITING_PLAN_APPROVAL: 'Awaiting Plan',
  TRANSFORMATION_LOOP: 'Transforming',
  AWAITING_HUMAN_INPUT: 'Awaiting Input',
  AWAITING_PIPELINE_CONFIRMATION: 'Ready for Pipeline',
  GENERATING: 'Generating',
  COMPLETE: 'Complete',
}

/**
 * Visual category for the session-card chip palette:
 * - awaiting  → warning (amber)
 * - progress  → info (blue)
 * - complete  → success (green)
 */
export type StageCategory = 'awaiting' | 'progress' | 'complete'

const AWAITING: WorkflowStage[] = [
  'AWAITING_INVESTIGATION_REVIEW',
  'AWAITING_RULE_APPROVAL',
  'RULE_REVIEW',
  'AWAITING_TRIAGE_APPROVAL',
  'AWAITING_PLAN_APPROVAL',
  'AWAITING_HUMAN_INPUT',
  'AWAITING_PIPELINE_CONFIRMATION',
  'PROFILING_SYNTHESIS',
]

export function stageCategory(stage: WorkflowStage): StageCategory {
  if (stage === 'COMPLETE') return 'complete'
  if (AWAITING.includes(stage)) return 'awaiting'
  return 'progress'
}

/**
 * Stage-specific subtitle shown under the date on a SessionCard. Returns null
 * when there's nothing useful to show — the caller hides the detail line.
 *
 * Reads from a SessionLike shape so the helper stays decoupled from the full
 * SessionListEntry/SessionState interfaces (and tolerates partial mock data).
 */
export interface SessionLike {
  stage: WorkflowStage
  rule_count?: number
  finding_count?: number
  baseline_score?: number
  current_score?: number
}

export function stageDetail(s: SessionLike): string | null {
  switch (s.stage) {
    case 'AWAITING_RULE_APPROVAL': {
      if (typeof s.rule_count === 'number') {
        const noun = s.rule_count === 1 ? 'rule' : 'rules'
        return `${s.rule_count} ${noun} awaiting decision`
      }
      return 'Awaiting rule decisions'
    }
    case 'RULE_REVIEW':
      return 'Reviewing rules for contradictions…'
    case 'AWAITING_TRIAGE_APPROVAL': {
      if (typeof s.finding_count === 'number') {
        const noun = s.finding_count === 1 ? 'finding' : 'findings'
        return `${s.finding_count} ${noun} to triage`
      }
      return 'Awaiting triage decisions'
    }
    case 'AWAITING_PLAN_APPROVAL':
      return 'Plan ready for review'
    case 'AWAITING_INVESTIGATION_REVIEW':
      return 'Exploration ready for review'
    case 'AWAITING_HUMAN_INPUT':
      return 'Awaiting your input'
    case 'AWAITING_PIPELINE_CONFIRMATION':
      return 'Ready to generate pipeline'
    case 'PROFILING_SYNTHESIS':
      return 'Synthesizing findings…'
    case 'VALIDATING':
      return 'Running validations…'
    case 'TRIAGING':
      return 'Triaging findings…'
    case 'PLANNING':
      return 'Planning transformations…'
    case 'TRANSFORMATION_LOOP':
      return 'Executing transformations…'
    case 'GENERATING':
      return 'Generating pipeline…'
    case 'REINVESTIGATING':
      return 'Re-investigating…'
    case 'PROFILING':
      return 'Profiling columns…'
    case 'COMPLETE': {
      if (typeof s.baseline_score === 'number' && typeof s.current_score === 'number') {
        const delta = Math.round((s.current_score - s.baseline_score) * 100)
        const sign = delta >= 0 ? '+' : ''
        return `${sign}${delta}% over baseline`
      }
      return null
    }
    default:
      return null
  }
}
