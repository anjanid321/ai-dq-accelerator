'use client'
import { ArrowRight } from 'lucide-react'

interface Props {
  approved: number
  denied: number
  undecided: number
  submitting: boolean
  onSubmit: () => void
}

function tallyItem(color: string, deep: string, label: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className={`text-[12px] font-medium ${deep}`}>{label}</span>
    </span>
  )
}

export function DecisionFooter({ approved, denied, undecided, submitting, onSubmit }: Props) {
  const disabled = undecided > 0 || submitting
  return (
    <div
      data-testid="decision-footer"
      className="bg-surface border-t border-border px-6 py-3 flex items-center gap-4 shrink-0"
    >
      <div className="flex items-center gap-4">
        {tallyItem('bg-success', 'text-success-deep', `${approved} Approved`)}
        {tallyItem('bg-danger',  'text-danger-deep',  `${denied} Denied`)}
        {tallyItem('bg-border-strong', 'text-fg-muted', `${undecided} Undecided`)}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        data-testid="submit-decisions"
        className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Submitting…' : 'Submit decisions'}
        {!submitting && <ArrowRight size={14} strokeWidth={2} />}
      </button>
    </div>
  )
}
