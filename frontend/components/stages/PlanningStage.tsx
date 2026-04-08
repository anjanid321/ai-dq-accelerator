'use client'

interface Props {
  message?: string
}

export function PlanningStage({ message }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted p-8">
      <div className="w-8 h-8 border-2 border-indigo border-t-transparent rounded-full animate-spin" />
      <div className="text-sm text-center">{message ?? 'AI is building your transformation plan...'}</div>
      <div className="text-xs text-text-muted/60 text-center">Investigation progress is visible in the AI panel on the right.</div>
    </div>
  )
}
