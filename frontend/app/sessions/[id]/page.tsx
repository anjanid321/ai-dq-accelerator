'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from '@/hooks/useSession'
import { useAIStream } from '@/hooks/useAIStream'
import { useSessionsList } from '@/hooks/useSessionsList'
import { TopBar } from '@/components/workspace/TopBar'
import { Stepper, type StageId } from '@/components/workspace/Stepper'
import { AIPanel } from '@/components/ai-panel/AIPanel'
import { LoadingStage } from '@/components/stages/LoadingStage'
import { ProfileStage } from '@/components/stages/ProfileStage'
import { RulesStage } from '@/components/stages/RulesStage'
import { ValidateStage } from '@/components/stages/ValidateStage'
import { PlanningStage } from '@/components/stages/PlanningStage'
import { PlanReviewStage } from '@/components/stages/PlanReviewStage'
import { ExecutionStage } from '@/components/stages/ExecutionStage'
import { ScorecardStage } from '@/components/stages/ScorecardStage'
import { PipelineStage } from '@/components/stages/PipelineStage'
import { TriageStage } from '@/components/stages/TriageStage'
import { ExplorationStage } from '@/components/stages/ExplorationStage'
import { SnapshotStageView } from '@/components/stages/SnapshotStageView'

function workflowToStepper(stage: string): { active: StageId; completed: StageId[] } {
  const ORDER: StageId[] = ['load', 'profile', 'explore', 'rules', 'validate', 'triage', 'plan', 'transform', 'scorecard', 'pipeline']
  const STAGE_MAP: Record<string, StageId> = {
    LOADING: 'load', PROFILING: 'profile',
    AWAITING_INVESTIGATION_REVIEW: 'explore', REINVESTIGATING: 'explore', PROFILING_SYNTHESIS: 'explore',
    RULE_REVIEW: 'rules', AWAITING_RULE_APPROVAL: 'rules', VALIDATING: 'validate',
    TRIAGING: 'triage', AWAITING_TRIAGE_APPROVAL: 'triage',
    PLANNING: 'plan', AWAITING_PLAN_APPROVAL: 'plan',
    TRANSFORMATION_LOOP: 'transform', AWAITING_HUMAN_INPUT: 'transform',
    AWAITING_PIPELINE_CONFIRMATION: 'pipeline',
    GENERATING: 'pipeline', COMPLETE: 'pipeline',
  }
  const active = STAGE_MAP[stage] ?? 'load'
  const idx = ORDER.indexOf(active)
  return { active, completed: ORDER.slice(0, idx) as StageId[] }
}

const WAITING_MESSAGES: Record<string, string> = {
  AWAITING_INVESTIGATION_REVIEW: 'Awaiting exploration review',
  REINVESTIGATING: 'Re-investigating…',
  PROFILING_SYNTHESIS: 'Synthesizing findings…',
  RULE_REVIEW: 'Reviewing rules for contradictions…',
  AWAITING_RULE_APPROVAL: 'Awaiting rule decisions',
  AWAITING_TRIAGE_APPROVAL: 'Awaiting triage decisions',
  AWAITING_PLAN_APPROVAL: 'Awaiting plan approval',
  TRANSFORMATION_LOOP: 'Executing transform plan...',
  AWAITING_HUMAN_INPUT: 'Awaiting your input',
  AWAITING_PIPELINE_CONFIRMATION: 'Awaiting pipeline confirmation',
}

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const [viewingStage, setViewingStage] = useState<StageId | null>(null)
  const isViewingPast = viewingStage !== null
  const { session, isLoading } = useSession(id, { enabled: !isViewingPast })
  const { events } = useAIStream(id)
  const { sessions } = useSessionsList()

  const filename = sessions.find(s => s.id === id)?.filename ?? id
  const stage = session?.stage ?? 'LOADING'
  const { active, completed } = workflowToStepper(stage)

  // auto-advance viewing stage when workflow advances
  useEffect(() => { setViewingStage(null) }, [active])

  const displayStage = viewingStage ?? active
  const isPastStage = viewingStage !== null && viewingStage !== active
  const isStreaming = events.length > 0 && events[events.length - 1]?.event !== 'done'

  function renderStage() {
    if (!session && isLoading) return <LoadingStage />
    switch (displayStage) {
      case 'load': return <LoadingStage />
      case 'profile': return <ProfileStage session={session!} onContinue={() => setViewingStage('explore')} />
      case 'explore': return <ExplorationStage sessionId={id} stage={stage} />
      case 'rules': return <RulesStage session={session!} />
      case 'validate': return <ValidateStage session={session ?? null} />
      case 'triage': return <TriageStage session={session!} />
      case 'plan': return session?.stage === 'PLANNING' ? <PlanningStage /> : <PlanReviewStage session={session!} />
      case 'transform': return <ExecutionStage session={session!} />
      case 'scorecard': return <ScorecardStage sessionId={id} />
      case 'pipeline': return <PipelineStage sessionId={id} stage={stage} />
      default: return <LoadingStage />
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar
        filename={filename}
        rowCount={session?.profile ? (session.profile as any).table?.n_rows : undefined}
        colCount={session?.profile ? (session.profile as any).table?.n_columns : undefined}
        currentScore={session?.current_score || undefined}
      />
      <div className="flex flex-1 overflow-hidden">
        <Stepper
          activeStage={active}
          completedStages={completed}
          viewingStage={displayStage}
          onStageClick={setViewingStage}
          activeSubStatus={WAITING_MESSAGES[stage]}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {isPastStage && (
            <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 text-xs text-warning-light flex items-center justify-between shrink-0">
              <span>Viewing past stage — {active} is the active stage</span>
              <button className="underline" onClick={() => setViewingStage(null)}>Return →</button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {isPastStage
              ? <SnapshotStageView sessionId={id} stage={viewingStage!} />
              : renderStage()}
          </div>
        </div>
        <AIPanel
          events={events}
          isStreaming={isStreaming}
          waitingMessage={WAITING_MESSAGES[stage]}
        />
      </div>
    </div>
  )
}
