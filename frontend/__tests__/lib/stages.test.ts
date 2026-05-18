// frontend/__tests__/lib/stages.test.ts
import {
  STAGE_LABELS,
  stageCategory,
  stageDetail,
  type SessionLike,
} from '@/lib/stages'
import type { WorkflowStage } from '@/lib/types'

describe('STAGE_LABELS', () => {
  it('has a non-empty label for every known stage', () => {
    const stages: WorkflowStage[] = [
      'LOADING','PROFILING',
      'AWAITING_INVESTIGATION_REVIEW','REINVESTIGATING','PROFILING_SYNTHESIS',
      'RULE_REVIEW','AWAITING_RULE_APPROVAL',
      'VALIDATING','TRIAGING','AWAITING_TRIAGE_APPROVAL',
      'PLANNING','AWAITING_PLAN_APPROVAL',
      'TRANSFORMATION_LOOP','AWAITING_HUMAN_INPUT',
      'AWAITING_PIPELINE_CONFIRMATION','GENERATING','COMPLETE',
    ]
    for (const s of stages) {
      expect(STAGE_LABELS[s].length).toBeGreaterThan(0)
    }
  })
})

describe('stageCategory', () => {
  it('routes AWAITING_* and RULE_REVIEW / PROFILING_SYNTHESIS to awaiting', () => {
    expect(stageCategory('AWAITING_RULE_APPROVAL')).toBe('awaiting')
    expect(stageCategory('AWAITING_INVESTIGATION_REVIEW')).toBe('awaiting')
    expect(stageCategory('AWAITING_TRIAGE_APPROVAL')).toBe('awaiting')
    expect(stageCategory('AWAITING_PLAN_APPROVAL')).toBe('awaiting')
    expect(stageCategory('AWAITING_HUMAN_INPUT')).toBe('awaiting')
    expect(stageCategory('AWAITING_PIPELINE_CONFIRMATION')).toBe('awaiting')
    expect(stageCategory('RULE_REVIEW')).toBe('awaiting')
    expect(stageCategory('PROFILING_SYNTHESIS')).toBe('awaiting')
  })

  it('routes AI-running stages to progress', () => {
    expect(stageCategory('LOADING')).toBe('progress')
    expect(stageCategory('PROFILING')).toBe('progress')
    expect(stageCategory('REINVESTIGATING')).toBe('progress')
    expect(stageCategory('VALIDATING')).toBe('progress')
    expect(stageCategory('TRIAGING')).toBe('progress')
    expect(stageCategory('PLANNING')).toBe('progress')
    expect(stageCategory('TRANSFORMATION_LOOP')).toBe('progress')
    expect(stageCategory('GENERATING')).toBe('progress')
  })

  it('routes COMPLETE to complete', () => {
    expect(stageCategory('COMPLETE')).toBe('complete')
  })

  it('falls back to progress for an unknown stage value', () => {
    expect(stageCategory('UNKNOWN_FUTURE_STAGE' as WorkflowStage)).toBe('progress')
  })
})

describe('stageDetail', () => {
  function s(stage: WorkflowStage, extra: Partial<SessionLike> = {}): SessionLike {
    return { stage, ...extra }
  }

  it('returns a count for AWAITING_RULE_APPROVAL when rule_count is provided', () => {
    expect(stageDetail(s('AWAITING_RULE_APPROVAL', { rule_count: 14 })))
      .toBe('14 rules awaiting decision')
  })

  it('returns the singular form for AWAITING_RULE_APPROVAL with one rule', () => {
    expect(stageDetail(s('AWAITING_RULE_APPROVAL', { rule_count: 1 })))
      .toBe('1 rule awaiting decision')
  })

  it('falls back to a generic awaiting message when rule_count is missing', () => {
    expect(stageDetail(s('AWAITING_RULE_APPROVAL'))).toBe('Awaiting rule decisions')
  })

  it('returns a baseline delta string for COMPLETE when both scores are present', () => {
    expect(stageDetail(s('COMPLETE', { baseline_score: 0.74, current_score: 0.92 })))
      .toBe('+18% over baseline')
  })

  it('returns null for COMPLETE when scores are missing (caller hides the detail line)', () => {
    expect(stageDetail(s('COMPLETE'))).toBeNull()
  })

  it('returns "Running validations…" for VALIDATING', () => {
    expect(stageDetail(s('VALIDATING'))).toBe('Running validations…')
  })

  it('returns "Plan ready for review" for AWAITING_PLAN_APPROVAL', () => {
    expect(stageDetail(s('AWAITING_PLAN_APPROVAL'))).toBe('Plan ready for review')
  })

  it('returns null for stages without a defined detail line (caller hides the line)', () => {
    expect(stageDetail(s('LOADING'))).toBeNull()
  })
})
