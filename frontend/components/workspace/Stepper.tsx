'use client'
import { Check } from 'lucide-react'

export type StageId = 'load' | 'profile' | 'explore' | 'rules' | 'validate' | 'triage' | 'plan' | 'transform' | 'scorecard' | 'pipeline'

const STAGES: { id: StageId; label: string }[] = [
  { id: 'load', label: 'Load' },
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

interface Props {
  activeStage: StageId
  completedStages: StageId[]
  viewingStage: StageId
  onStageClick: (stage: StageId) => void
  activeSubStatus?: string
}

type CircleState = 'default' | 'active' | 'done' | 'locked'

function StageCircle({ state }: { state: CircleState }) {
  if (state === 'active') {
    return (
      <div className="w-[18px] h-[18px] rounded-full bg-brand-primary shrink-0 flex items-center justify-center">
        <div className="w-[6px] h-[6px] rounded-full bg-fg-inverse" />
      </div>
    )
  }
  if (state === 'done') {
    return (
      <div className="w-[18px] h-[18px] rounded-full bg-success shrink-0 flex items-center justify-center text-fg-inverse">
        <Check size={10} strokeWidth={2.5} />
      </div>
    )
  }
  if (state === 'locked') {
    return (
      <div className="w-[18px] h-[18px] rounded-full bg-border-strong shrink-0 flex items-center justify-center">
        <div className="w-[4px] h-[4px] rounded-full bg-fg-subtle" />
      </div>
    )
  }
  // default
  return (
    <div className="w-[18px] h-[18px] rounded-full border border-border-strong shrink-0" />
  )
}

export function Stepper({ activeStage, completedStages, viewingStage, onStageClick, activeSubStatus }: Props) {
  return (
    <div
      className="bg-surface border-r border-border shrink-0 overflow-y-auto py-3"
      style={{ width: 220 }}
    >
      {/* Outer container — paddingLeft 14 + row p-1.5 = 20px circle x-position */}
      <div className="relative" style={{ paddingLeft: 14, paddingRight: 14 }}>
        {STAGES.map((s, i) => {
          const done = completedStages.includes(s.id)
          const active = s.id === activeStage
          const viewing = s.id === viewingStage
          const clickable = done && s.id !== activeStage

          const circleState: CircleState = done ? 'done' : active ? 'active' : 'locked'

          // Connector color: success if this stage is done AND next stage is done-or-active, else border-strong
          const nextS = STAGES[i + 1]
          const nextDone = nextS ? completedStages.includes(nextS.id) : false
          const nextActive = nextS ? nextS.id === activeStage : false
          const connectorSuccess = done && (nextDone || nextActive)

          const labelClass = (active || viewing)
            ? 'text-fg font-semibold'
            : 'text-fg-muted'

          return (
            <div key={s.id}>
              {/* Stage row: 6px padding all sides, rounded so default and hover share chrome */}
              <div
                className={`relative flex items-center gap-3 p-1.5 rounded-md ${clickable ? 'cursor-pointer hover:bg-elevated' : ''}`}
                onClick={() => clickable && onStageClick(s.id)}
              >
                <StageCircle state={circleState} />
                <div className="flex flex-col justify-center min-w-0">
                  <span className={`text-[13px] leading-none ${labelClass}`}>
                    {s.label}
                  </span>
                  {active && activeSubStatus && (
                    <span className="text-[12px] text-fg-muted mt-1.5 truncate">
                      {activeSubStatus}
                    </span>
                  )}
                </div>
              </div>

              {/* Connector between this row and the next.
                  Position: container paddingLeft 14 + row p-1.5 (6) + circle half-width 9 − stroke half 0.75 = 28.25px */}
              {i < STAGES.length - 1 && (
                <div
                  className={`${connectorSuccess ? 'bg-success' : 'bg-border-strong'}`}
                  style={{
                    position: 'relative',
                    left: 14 - 0.75,
                    width: '1.5px',
                    height: 12,
                    margin: '2px 0',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
