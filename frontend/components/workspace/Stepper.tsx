'use client'

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
        <div className="w-[6px] h-[6px] rounded-full bg-white" />
      </div>
    )
  }
  if (state === 'done') {
    return (
      <div className="w-[18px] h-[18px] rounded-full bg-success shrink-0 flex items-center justify-center">
        <svg width="9" height="7" viewBox="0 0 9 7" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polyline points="1,3.5 3.5,6 8,1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
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
      className="bg-surface border-r border-border shrink-0 overflow-y-auto py-5"
      style={{ width: 220 }}
    >
      {/* Outer container with left padding = 20px so circles start at x=20 */}
      <div className="relative" style={{ paddingLeft: 20, paddingRight: 16 }}>
        {STAGES.map((s, i) => {
          const done = completedStages.includes(s.id)
          const active = s.id === activeStage
          const viewing = s.id === viewingStage
          const locked = !done && !active
          const clickable = done && s.id !== activeStage

          const circleState: CircleState = done ? 'done' : active ? 'active' : 'locked'

          // Connector color: success if this stage is done AND next stage is done-or-active, else border-strong
          const nextS = STAGES[i + 1]
          const nextDone = nextS ? completedStages.includes(nextS.id) : false
          const nextActive = nextS ? nextS.id === activeStage : false
          const connectorSuccess = done && (nextDone || nextActive)

          // Label color
          const labelClass = (active || viewing)
            ? 'text-fg font-semibold'
            : 'text-fg-muted'

          return (
            <div key={s.id}>
              {/* Stage row: 48px height to match 48px pitch */}
              <div
                className={`relative flex items-center gap-4 ${clickable ? 'cursor-pointer rounded-lg hover:bg-elevated' : ''}`}
                style={{ height: 48 }}
                onClick={() => clickable && onStageClick(s.id)}
              >
                {/* Circle — positioned inline (flex); its left edge is at paddingLeft=20 */}
                <StageCircle state={circleState} />

                {/* Label + optional sub-status */}
                <div className="flex flex-col justify-center min-w-0">
                  <span
                    className={`text-[13px] leading-none ${labelClass}`}
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    {s.label}
                  </span>
                  {active && activeSubStatus && (
                    <span
                      className="text-[12px] text-fg-subtle mt-1 truncate"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      {activeSubStatus}
                    </span>
                  )}
                </div>
              </div>

              {/* Connector segment between this stage and the next */}
              {i < STAGES.length - 1 && (
                <div
                  className={`${connectorSuccess ? 'bg-success' : 'bg-border-strong'}`}
                  style={{
                    /* center horizontally on the circle center: circle left edge = 0 (within padding), circle center = 9px */
                    position: 'relative',
                    left: 9 - 0.75, /* 9px = circle center offset from padding edge, 0.75 = half of 1.5px width */
                    width: '1.5px',
                    height: 30,
                    marginTop: 0,
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
