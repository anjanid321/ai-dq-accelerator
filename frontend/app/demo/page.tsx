// frontend/app/demo/page.tsx
//
// Persistent demo route for walking the Round 2 redesigns (Load → Profile →
// Explore → Rules) against frozen mock state. Mirrors the workspace shell
// (TopBar + Stepper + stage content + AIPanel) but skips every API call by
// driving the real components with hand-curated fixtures.
'use client'

import { useState } from 'react'
import { TopBar } from '@/components/workspace/TopBar'
import { Stepper, type StageId } from '@/components/workspace/Stepper'
import { AIPanel } from '@/components/ai-panel/AIPanel'
import { LoadingStage } from '@/components/stages/LoadingStage'
import { ProfileStage } from '@/components/stages/ProfileStage'
import { ExplorationStage } from '@/components/stages/ExplorationStage'
import { RulesStage } from '@/components/stages/RulesStage'
import {
  DEMO_AI_EVENTS,
  DEMO_EXPLORE_STATE,
  DEMO_FILENAME,
  DEMO_PROFILE_SESSION,
  DEMO_PROFILE_TABLE,
  DEMO_RULES_SESSION,
} from './_fixtures/mock-session'

const DEMO_STAGES: StageId[] = ['load', 'profile', 'explore', 'rules']

const WAITING_MESSAGES: Record<StageId, string | undefined> = {
  load: 'Loading dataset…',
  profile: 'Profiling complete',
  explore: 'Awaiting exploration review',
  rules: 'Awaiting rule decisions',
  validate: undefined,
  triage: undefined,
  plan: undefined,
  transform: undefined,
  scorecard: undefined,
  pipeline: undefined,
}

function OutOfScopePlaceholder({ stage }: { stage: StageId }) {
  return (
    <div className="p-5 flex flex-col items-center justify-center h-full gap-3 text-center">
      <div className="text-sm font-semibold text-fg">{stage} stage not in demo scope</div>
      <p className="text-xs text-fg-muted max-w-md">
        The /demo route covers the Round 2 redesigns shipped so far — Load, Profile, Explore, and Rules. Later stages will land here as they're retokenized.
      </p>
    </div>
  )
}

export default function DemoPage() {
  const [viewingStage, setViewingStage] = useState<StageId>('profile')

  const isExploreOnward =
    viewingStage === 'explore' ||
    viewingStage === 'rules' ||
    viewingStage === 'validate' ||
    viewingStage === 'triage' ||
    viewingStage === 'plan' ||
    viewingStage === 'transform' ||
    viewingStage === 'scorecard' ||
    viewingStage === 'pipeline'

  const isRulesOnward =
    viewingStage === 'rules' ||
    viewingStage === 'validate' ||
    viewingStage === 'triage' ||
    viewingStage === 'plan' ||
    viewingStage === 'transform' ||
    viewingStage === 'scorecard' ||
    viewingStage === 'pipeline'

  const sessionForTopBar = isRulesOnward ? DEMO_RULES_SESSION : DEMO_PROFILE_SESSION

  // Stepper completion mirrors a session sitting at AWAITING_RULE_APPROVAL.
  // load and profile are always "completed" in this demo's storyline; explore
  // flips to completed once you click past it.
  const completed: StageId[] = ['load', 'profile']
  if (isRulesOnward) completed.push('explore')

  // Active = the workflow's "where it really is" stage. In the demo we treat
  // "rules" as the live position (matches the AWAITING_RULE_APPROVAL fixture).
  const active: StageId = 'rules'

  function renderStage() {
    switch (viewingStage) {
      case 'load':
        return <LoadingStage />
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
        return <RulesStage session={DEMO_RULES_SESSION} readOnly />
      default:
        return <OutOfScopePlaceholder stage={viewingStage} />
    }
  }

  const isPastStage = viewingStage !== active && DEMO_STAGES.includes(viewingStage)

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="bg-elevated border-b border-border px-4 py-1.5 text-[11px] text-fg-muted flex items-center gap-3 shrink-0">
        <span className="font-semibold text-fg">Demo mode</span>
        <span>walking the Round 2 redesigns against frozen mock data — no backend involved.</span>
      </div>
      <TopBar
        filename={DEMO_FILENAME}
        rowCount={DEMO_PROFILE_TABLE.n_rows}
        colCount={DEMO_PROFILE_TABLE.n_columns}
        currentScore={isExploreOnward ? sessionForTopBar.current_score : undefined}
      />
      <div className="flex flex-1 overflow-hidden">
        <Stepper
          activeStage={active}
          completedStages={completed}
          viewingStage={viewingStage}
          onStageClick={(s) => setViewingStage(s)}
          activeSubStatus={WAITING_MESSAGES[active]}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {isPastStage && (
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
