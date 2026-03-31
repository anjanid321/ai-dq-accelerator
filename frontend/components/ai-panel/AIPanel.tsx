'use client'
import { useState } from 'react'
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
    <div className="w-[300px] bg-[#080b14] border-l border-border flex flex-col shrink-0">
      <div className="px-3.5 py-2.5 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <div className={`w-1.5 h-1.5 rounded-full ${isStreaming ? 'bg-success' : waitingMessage ? 'bg-warning' : 'bg-text-muted'}`} />
          AI Activity
        </div>
        <div className="flex bg-surface rounded-md p-0.5 gap-0.5">
          {(['feed', 'terminal'] as const).map(v => (
            <button key={v} className={`text-[10px] px-2 py-1 rounded capitalize ${view === v ? 'bg-border text-text-primary' : 'text-text-muted'}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
      </div>

      {view === 'feed' ? <EventFeed events={events} /> : <EventTerminal events={events} />}

      {waitingMessage && (
        <div className="m-2 bg-warning/10 border border-warning/30 rounded-lg p-2.5 text-[10px] text-warning-light shrink-0">
          ⏸ {waitingMessage}
        </div>
      )}
    </div>
  )
}
