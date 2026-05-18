'use client'
import { useState } from 'react'
import { Pause } from 'lucide-react'
import type { AIEvent } from '@/hooks/useAIStream'
import { EventFeed } from './EventFeed'
import { EventTerminal } from './EventTerminal'

interface Props {
  events: AIEvent[]
  isStreaming: boolean
  waitingMessage?: string
}

export function AIPanel({ events, isStreaming, waitingMessage }: Props) {
  const [view, setView] = useState<'feed' | 'terminal'>('feed')

  return (
    <div className="w-[340px] bg-surface border-l border-border flex flex-col shrink-0 h-full">
      {/* ── Header ── */}
      <div className="px-3.5 h-12 flex items-center shrink-0 border-b border-border">
        {/* Status dot */}
        <div
          className={[
            'w-2 h-2 rounded-full shrink-0',
            isStreaming ? 'bg-success' : waitingMessage ? 'bg-warning' : 'bg-fg-subtle',
          ].join(' ')}
        />
        {/* Title */}
        <span className="ml-1.5 text-[12px] leading-[14px] font-semibold text-fg">
          AI Activity
        </span>
        {/* Spacer */}
        <div className="flex-1" />
        {/* Segmented control */}
        <div className="h-6 flex items-center bg-elevated rounded px-0.5 gap-0.5">
          {(['feed', 'terminal'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={[
                'text-[11px] px-2.5 py-0.5 rounded capitalize transition-colors',
                view === v
                  ? 'bg-surface text-fg border border-border'
                  : 'text-fg-muted',
              ].join(' ')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ── Feed / Terminal ── */}
      {view === 'feed' ? <EventFeed events={events} /> : <EventTerminal events={events} />}

      {/* ── Waiting banner (footer bar) ── */}
      {waitingMessage && (
        <div className="w-full bg-elevated border-t border-border py-3.5 px-3 flex items-center justify-center gap-2 shrink-0 text-fg-muted">
          <Pause size={14} strokeWidth={2} />
          <span className="text-[12px] font-semibold">{waitingMessage}</span>
        </div>
      )}
    </div>
  )
}
