// frontend/components/ai-panel/ScrollToLatestPill.tsx
'use client'
import { ArrowDown } from 'lucide-react'

interface Props {
  unreadCount: number
  onClick: () => void
}

export function ScrollToLatestPill({ unreadCount, onClick }: Props) {
  const label = unreadCount > 0 ? `${unreadCount} new` : 'Scroll to bottom'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-live="polite"
      aria-label={label}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 bg-brand-accent text-on-brand text-[13px] font-semibold px-4 py-2 rounded-md hover:bg-brand-accent/90 hover:shadow-md transition-all"
    >
      <ArrowDown size={14} strokeWidth={2} />
      {label}
    </button>
  )
}
