'use client'

export type StageId = 'load' | 'profile' | 'rules' | 'validate' | 'triage' | 'plan' | 'transform' | 'scorecard' | 'pipeline'

const STAGES: { id: StageId; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'profile', label: 'Profile' },
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
}

export function Stepper({ activeStage, completedStages, viewingStage, onStageClick }: Props) {
  return (
    <div className="w-40 bg-elevated border-r border-border px-3 py-5 shrink-0 flex flex-col gap-0.5 overflow-y-auto">
      {STAGES.map((s, i) => {
        const done = completedStages.includes(s.id)
        const active = s.id === activeStage
        const viewing = s.id === viewingStage
        const locked = !done && !active
        const clickable = done && s.id !== activeStage

        return (
          <div key={s.id}>
            <div
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${viewing ? 'bg-indigo/10' : ''} ${clickable ? 'cursor-pointer hover:bg-white/5' : ''} ${locked ? 'opacity-35' : ''}`}
              onClick={() => clickable && onStageClick(s.id)}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${done ? 'bg-success' : active ? 'bg-indigo shadow-[0_0_6px_#6366f1]' : 'bg-border border border-text-muted'}`} />
              <span className={`text-xs ${viewing ? 'text-text-primary font-semibold' : done ? 'text-text-muted' : active ? 'text-text-primary font-semibold' : 'text-text-muted'}`}>
                {s.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`w-px h-3.5 ml-[19px] ${done ? 'bg-success/40' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
