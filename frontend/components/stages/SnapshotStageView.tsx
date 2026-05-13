'use client'
import { useStageSnapshot } from '@/hooks/useStageSnapshot'
import type { StageId } from '@/components/workspace/Stepper'
import type { SessionState } from '@/lib/types'
import { LoadingStage } from './LoadingStage'
import { ProfileStage } from './ProfileStage'
import { ExplorationStage } from './ExplorationStage'
import { RulesStage } from './RulesStage'
import { ValidateStage } from './ValidateStage'
import { TriageStage } from './TriageStage'
import { PlanReviewStage } from './PlanReviewStage'
import { ExecutionStage } from './ExecutionStage'
import { ScorecardStage } from './ScorecardStage'
import { PipelineStage } from './PipelineStage'

interface Props {
  sessionId: string
  stage: StageId
}

const BACKEND_STAGE: Partial<Record<StageId, string>> = {
  profile: 'profile',
  explore: 'explore',
  rules: 'rules',
  validate: 'validate',
  triage: 'triage',
  plan: 'plan',
  transform: 'transform',
  scorecard: 'scorecard',
  pipeline: 'pipeline',
}

export function SnapshotStageView({ sessionId, stage }: Props) {
  const backendStage = BACKEND_STAGE[stage] ?? null
  const { snapshot, isLoading } = useStageSnapshot(sessionId, backendStage, backendStage !== null)

  if (isLoading) return <LoadingStage />

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No snapshot available for this stage.
      </div>
    )
  }

  const p = snapshot.payload

  // ScorecardStage and PipelineStage fetch their own data via sessionId — no SessionState needed.
  if (stage === 'scorecard') return <ScorecardStage sessionId={sessionId} readOnly />
  if (stage === 'pipeline') return <PipelineStage sessionId={sessionId} stage="COMPLETE" readOnly />

  // ExplorationStage fetches its own state via sessionId.
  if (stage === 'explore') return <ExplorationStage sessionId={sessionId} stage="COMPLETE" readOnly />

  const fakeSession: SessionState = {
    session_id: sessionId,
    stage: 'COMPLETE' as SessionState['stage'],
    profile: (p.profile as Record<string, unknown>) ?? {},
    ai_summary: (p.ai_summary as string) ?? '',
    suggested_rules: (p.suggested_rules as SessionState['suggested_rules']) ?? [],
    baseline_quality_score: (p.baseline_quality_score as number) ?? 0,
    current_score: (p.current_score as number) ?? 0,
    validation_summary: (p.validation_summary as string) ?? '',
    anomaly_summary: (p.anomaly_summary as string) ?? '',
    transformation_log: (p.transformation_log as SessionState['transformation_log']) ?? [],
    validation_results: (p.validation_results as SessionState['validation_results']) ?? undefined,
    triage_result: p.triage_result as SessionState['triage_result'],
    transform_plan: p.transform_plan as SessionState['transform_plan'],
    execution_escalation: undefined,
    scorecard: (p.scorecard as Record<string, unknown>) ?? {},
    narrative: (p.narrative as string) ?? '',
    output_dir: (p.output_dir as string) ?? '',
    zip_path: (p.zip_path as string) ?? '',
  }

  switch (stage) {
    case 'profile': return <ProfileStage session={fakeSession} onContinue={() => {}} readOnly />
    case 'rules': return <RulesStage session={fakeSession} readOnly />
    case 'validate': return <ValidateStage session={fakeSession} readOnly />
    case 'triage': return <TriageStage session={fakeSession} readOnly />
    case 'plan': return <PlanReviewStage session={fakeSession} readOnly />
    case 'transform': return <ExecutionStage session={fakeSession} readOnly />
    default: return <LoadingStage />
  }
}
