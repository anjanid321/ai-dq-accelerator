'use client'
import { Upload } from 'lucide-react'
import { Logo } from '@/components/theme/Logo'

interface Props {
  onNewSession: () => void
}

export function SessionsTopBar({ onNewSession }: Props) {
  return (
    <div className="h-14 bg-surface border-b border-border flex items-center gap-3 px-4 shrink-0">
      <Logo />
      <span className="text-sm font-semibold text-fg">DQ Accelerator</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onNewSession}
        data-testid="new-session"
        className="inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
      >
        <Upload size={14} strokeWidth={2} />
        New session
      </button>
    </div>
  )
}
