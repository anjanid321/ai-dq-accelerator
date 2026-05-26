// frontend/app/demo/page.tsx
//
// Persistent demo route for walking the Round 2 redesigns against frozen mock
// data. Opens on the sessions-list screen (matches the real homepage chrome)
// and lets you click a card to enter the workspace shell for the Round-2
// stages (Profile → Explore → Rules → Validate → Triage). Load is no longer
// a stepper item — it's a banner above Profile. No backend, no polling, no
// API calls.
'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { SessionListEntry, WorkflowStage } from '@/lib/types'
import { TopBar } from '@/components/workspace/TopBar'
import { Stepper, type StageDef, type StageId } from '@/components/workspace/Stepper'
import { AIPanel } from '@/components/ai-panel/AIPanel'
import { ProfileStage } from '@/components/stages/ProfileStage'
import { ExplorationStage } from '@/components/stages/ExplorationStage'
import { RulesStage } from '@/components/stages/RulesStage'
import { ValidateStage } from '@/components/stages/ValidateStage'
import { TriageStage } from '@/components/stages/TriageStage'
import { PlanReviewStage } from '@/components/stages/PlanReviewStage'
import { ExecutionStage } from '@/components/stages/ExecutionStage'
import { ScorecardStage } from '@/components/stages/ScorecardStage'
import { PipelineStage } from '@/components/stages/PipelineStage'
import { SessionCard } from '@/components/sessions/SessionCard'
import { SessionsTopBar } from '@/components/sessions/SessionsTopBar'
import { UploadModal } from '@/components/sessions/UploadModal'
import { stageCategory } from '@/lib/stages'
import {
  DEMO_AI_EVENTS,
  DEMO_EXPLORE_STATE,
  DEMO_FILENAME,
  DEMO_PROFILE_SESSION,
  DEMO_PROFILE_TABLE,
  DEMO_RULES_SESSION,
  DEMO_VALIDATE_SESSION,
  DEMO_TRIAGE_SESSION,
  DEMO_PLAN_SESSION,
  DEMO_TRANSFORM_SESSION,
  DEMO_SCORECARD_DATA,
  DEMO_SESSIONS_LIST,
} from './_fixtures/mock-session'

const DEMO_STAGES: StageId[] = ['profile', 'explore', 'rules', 'validate', 'triage', 'plan', 'transform', 'scorecard', 'pipeline']

// Stepper sidebar omits 'load' — loading is shown as a banner above the
// Profile stage content instead of a separate clickable stage.
const DEMO_STAGE_LIST: StageDef[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'explore', label: 'Explore' },
  { id: 'rules', label: 'Rules' },
  { id: 'validate', label: 'Validate' },
  { id: 'triage', label: 'Triage' },
  { id: 'plan', label: 'Plan' },
  { id: 'transform', label: 'Transform' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'pipeline', label: 'Pipeline' },
]

const WAITING_MESSAGES: Record<StageId, string | undefined> = {
  load: undefined,
  profile: 'Profiling complete',
  explore: 'Awaiting exploration review',
  rules: 'Awaiting rule decisions',
  validate: 'Running validation rules…',
  triage: 'Awaiting triage decisions',
  plan: 'Awaiting plan approval',
  transform: 'Executing transformations…',
  scorecard: 'Reviewing scorecard',
  pipeline: 'Ready to generate',
}

function OutOfScopePlaceholder({ stage }: { stage: StageId }) {
  return (
    <div className="p-5 flex flex-col items-center justify-center h-full gap-3 text-center">
      <div className="text-sm font-semibold text-fg">{stage} stage not in demo scope</div>
      <p className="text-xs text-fg-muted max-w-md">
        The /demo route walks the full Round 2 redesign — Sessions, Profile, Explore, Rules, Validate, Triage, Plan, Transform, Scorecard, and Pipeline.
      </p>
    </div>
  )
}

function DemoBanner({ onBack }: { onBack?: () => void }) {
  return (
    <div className="bg-elevated border-b border-border px-4 py-1.5 text-xs text-fg-muted flex items-center gap-3 shrink-0">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-fg-muted hover:text-fg transition-colors"
        >
          <ChevronLeft size={12} strokeWidth={2} />
          Sessions
        </button>
      )}
      <span className="font-semibold text-fg">Demo mode</span>
      <span>walking the Round 2 redesigns against frozen mock data — no backend involved.</span>
    </div>
  )
}

function SessionsList({ onOpen }: { onOpen: (id: string) => void }) {
  const [showUpload, setShowUpload] = useState(false)
  const grouped = useMemo(() => {
    const inProgress = DEMO_SESSIONS_LIST.filter((s) => stageCategory(s.stage) !== 'complete')
    const complete = DEMO_SESSIONS_LIST.filter((s) => stageCategory(s.stage) === 'complete')
    return { inProgress, complete }
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <DemoBanner />
      <SessionsTopBar onNewSession={() => setShowUpload(true)} />
      <div className="flex-1 bg-canvas p-6 flex flex-col gap-5">
        {grouped.inProgress.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">In progress</div>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
              {grouped.inProgress.map((s) => (
                <SessionCard
                  key={s.id}
                  entry={s}
                  onOpen={() => onOpen(s.id)}
                  onDeleted={() => { /* demo: no real delete */ }}
                />
              ))}
            </div>
          </section>
        )}

        {grouped.complete.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Complete</div>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
              {grouped.complete.map((s) => (
                <SessionCard
                  key={s.id}
                  entry={s}
                  onOpen={() => onOpen(s.id)}
                  onDeleted={() => { /* demo: no real delete */ }}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {showUpload && (
        <UploadModal
          demoMode
          onCreated={() => setShowUpload(false)}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  )
}

const STAGE_ORDER: StageId[] = [
  'profile', 'explore', 'rules',
  'validate', 'triage', 'plan', 'transform', 'scorecard', 'pipeline',
]

// Maps a session's backend WorkflowStage to the demo's active stepper StageId.
// LOADING/PROFILING land on 'profile' since the load step is folded into the
// profile-stage LoadInfoRow. COMPLETE lands on 'pipeline' (the last step).
const STAGE_MAP: Record<WorkflowStage, StageId> = {
  LOADING: 'profile',
  PROFILING: 'profile',
  AWAITING_INVESTIGATION_REVIEW: 'explore',
  REINVESTIGATING: 'explore',
  PROFILING_SYNTHESIS: 'explore',
  RULE_REVIEW: 'rules',
  AWAITING_RULE_APPROVAL: 'rules',
  VALIDATING: 'validate',
  TRIAGING: 'triage',
  AWAITING_TRIAGE_APPROVAL: 'triage',
  PLANNING: 'plan',
  AWAITING_PLAN_APPROVAL: 'plan',
  TRANSFORMATION_LOOP: 'transform',
  AWAITING_HUMAN_INPUT: 'transform',
  AWAITING_PIPELINE_CONFIRMATION: 'pipeline',
  GENERATING: 'pipeline',
  COMPLETE: 'pipeline',
}

function Workspace({ sessionEntry, onBack }: { sessionEntry: SessionListEntry; onBack: () => void }) {
  const active = STAGE_MAP[sessionEntry.stage]
  const isComplete = sessionEntry.stage === 'COMPLETE'
  // For COMPLETE sessions, every stage including Pipeline is done — pass the
  // full order as completedStages so each circle renders green-check. For
  // earlier sessions, completed = stages before active.
  const completed = isComplete
    ? STAGE_ORDER
    : STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(active))

  const [viewingStage, setViewingStage] = useState<StageId>(active)

  function renderStage() {
    switch (viewingStage) {
      case 'profile':
        return (
          <ProfileStage
            session={DEMO_PROFILE_SESSION}
            onContinue={() => setViewingStage('explore')}
          />
        )
      case 'explore':
        return (
          <ExplorationStage
            sessionId="demo"
            stage="AWAITING_INVESTIGATION_REVIEW"
            mockState={DEMO_EXPLORE_STATE}
          />
        )
      case 'rules':
        return <RulesStage session={DEMO_RULES_SESSION} demoMode />
      case 'validate':
        return (
          <ValidateStage
            session={DEMO_VALIDATE_SESSION}
            onContinue={() => setViewingStage('triage')}
          />
        )
      case 'triage':
        return <TriageStage session={DEMO_TRIAGE_SESSION} />
      case 'plan':
        return <PlanReviewStage session={DEMO_PLAN_SESSION} demoMode />
      case 'transform':
        return <ExecutionStage session={DEMO_TRANSFORM_SESSION} demoMode />
      case 'scorecard':
        return <ScorecardStage sessionId="demo" data={DEMO_SCORECARD_DATA} />
      case 'pipeline':
        return (
          <PipelineStage
            sessionId="demo"
            stage={isComplete ? 'COMPLETE' : 'AWAITING_PIPELINE_CONFIRMATION'}
            demoMode
          />
        )
      default:
        return <OutOfScopePlaceholder stage={viewingStage} />
    }
  }

  const isPastStage = viewingStage !== active && DEMO_STAGES.includes(viewingStage)
  const activeSubStatus = isComplete ? undefined : WAITING_MESSAGES[active]

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <DemoBanner onBack={onBack} />
      <TopBar
        filename={sessionEntry.filename}
        rowCount={DEMO_PROFILE_TABLE.n_rows}
        colCount={DEMO_PROFILE_TABLE.n_columns}
        currentScore={sessionEntry.current_score ?? 0}
      />
      <div className="flex flex-1 overflow-hidden">
        <Stepper
          activeStage={active}
          completedStages={completed}
          viewingStage={viewingStage}
          onStageClick={(s) => setViewingStage(s)}
          activeSubStatus={activeSubStatus}
          stages={DEMO_STAGE_LIST}
          loadStatus="loaded"
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {isPastStage && !isComplete && (
            <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 text-xs text-warning-light flex items-center justify-between shrink-0">
              <span>Viewing past stage — {active} is the active stage</span>
              <button className="underline" onClick={() => setViewingStage(active)}>
                Return →
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">{renderStage()}</div>
        </div>
        <AIPanel
          events={DEMO_AI_EVENTS}
          isStreaming={false}
          waitingMessage={WAITING_MESSAGES[viewingStage]}
        />
      </div>
    </div>
  )
}

export default function DemoPage() {
  const [openedSession, setOpenedSession] = useState<SessionListEntry | null>(null)

  if (!openedSession) {
    return (
      <SessionsList
        onOpen={(id) => {
          const entry = DEMO_SESSIONS_LIST.find((s) => s.id === id)
          if (entry) setOpenedSession(entry)
        }}
      />
    )
  }
  return <Workspace sessionEntry={openedSession} onBack={() => setOpenedSession(null)} />
}
