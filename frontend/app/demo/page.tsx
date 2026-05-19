// frontend/app/demo/page.tsx
//
// Persistent demo route for walking the Round 2 redesigns against frozen mock
// data. Opens on the sessions-list screen (matches the real homepage chrome)
// and lets you click a card to enter the workspace shell for the 4 Round-2
// stages (Load → Profile → Explore → Rules). No backend, no polling, no API
// calls.
'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { TopBar } from '@/components/workspace/TopBar'
import { Stepper, type StageId } from '@/components/workspace/Stepper'
import { AIPanel } from '@/components/ai-panel/AIPanel'
import { LoadingStage } from '@/components/stages/LoadingStage'
import { ProfileStage } from '@/components/stages/ProfileStage'
import { ExplorationStage } from '@/components/stages/ExplorationStage'
import { RulesStage } from '@/components/stages/RulesStage'
import { SessionCard } from '@/components/sessions/SessionCard'
import { SessionsTopBar } from '@/components/sessions/SessionsTopBar'
import { stageCategory } from '@/lib/stages'
import {
  DEMO_AI_EVENTS,
  DEMO_EXPLORE_STATE,
  DEMO_FILENAME,
  DEMO_PROFILE_SESSION,
  DEMO_PROFILE_TABLE,
  DEMO_RULES_SESSION,
  DEMO_SESSIONS_LIST,
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
        The /demo route covers the Round 2 redesigns shipped so far — Sessions, Load, Profile, Explore, and Rules. Later stages will land here as they're retokenized.
      </p>
    </div>
  )
}

function DemoBanner({ onBack }: { onBack?: () => void }) {
  return (
    <div className="bg-elevated border-b border-border px-4 py-1.5 text-[11px] text-fg-muted flex items-center gap-3 shrink-0">
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
  const grouped = useMemo(() => {
    const inProgress = DEMO_SESSIONS_LIST.filter((s) => stageCategory(s.stage) !== 'complete')
    const complete = DEMO_SESSIONS_LIST.filter((s) => stageCategory(s.stage) === 'complete')
    return { inProgress, complete }
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <DemoBanner />
      <SessionsTopBar onNewSession={() => { /* upload flow disabled in demo */ }} />
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
    </div>
  )
}

function Workspace({ onBack }: { onBack: () => void }) {
  const [viewingStage, setViewingStage] = useState<StageId>('profile')

  // The demo's "live workflow position" is fixed at Rules. Completion and the
  // TopBar score follow `active` (matches the real workspace, where current
  // state doesn't change as the user clicks back through the stepper).
  const STAGE_ORDER: StageId[] = [
    'load', 'profile', 'explore', 'rules',
    'validate', 'triage', 'plan', 'transform', 'scorecard', 'pipeline',
  ]
  const active: StageId = 'rules'
  const completed: StageId[] = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(active))

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
      <DemoBanner onBack={onBack} />
      <TopBar
        filename={DEMO_FILENAME}
        rowCount={DEMO_PROFILE_TABLE.n_rows}
        colCount={DEMO_PROFILE_TABLE.n_columns}
        currentScore={DEMO_RULES_SESSION.current_score}
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

export default function DemoPage() {
  const [view, setView] = useState<'list' | 'workspace'>('list')

  if (view === 'list') {
    return <SessionsList onOpen={() => setView('workspace')} />
  }
  return <Workspace onBack={() => setView('list')} />
}
