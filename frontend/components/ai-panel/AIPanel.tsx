'use client'
import { useEffect, useState } from 'react'
import { Hand, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { AIEvent } from '@/hooks/useAIStream'
import { EventFeed } from './EventFeed'
import { EventTerminal } from './EventTerminal'

interface Props {
  events: AIEvent[]
  isStreaming: boolean
  waitingMessage?: string
}

const STORAGE_KEY = 'ai-panel-collapsed'

export function AIPanel({ events, isStreaming, waitingMessage }: Props) {
  const [view, setView] = useState<'feed' | 'terminal'>('feed')
  const [collapsed, setCollapsed] = useState<boolean>(false)

  // Restore + persist collapsed preference
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === '1') setCollapsed(true)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const statusClass = isStreaming ? 'bg-success' : waitingMessage ? 'bg-warning' : 'bg-fg-subtle'

  // ── Collapsed rail ──
  if (collapsed) {
    return (
      <div className="w-12 bg-surface border-l border-border flex flex-col items-center py-3 gap-3 shrink-0 h-full">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand AI activity panel"
          className="w-8 h-8 rounded-md flex items-center justify-center text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <PanelRightOpen size={18} strokeWidth={2} />
        </button>
        <span className={['w-2 h-2 rounded-full shrink-0', statusClass].join(' ')} />
        {waitingMessage && (
          <div className="text-fg-muted" title={waitingMessage}>
            <Hand size={14} strokeWidth={2} />
          </div>
        )}
      </div>
    )
  }

  // ── Expanded panel ──
  return (
    <div className="w-[340px] bg-surface border-l border-border flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="px-3.5 h-12 flex items-center shrink-0 border-b border-border gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse AI activity panel"
          className="text-fg-muted hover:text-fg shrink-0"
        >
          <PanelRightClose size={16} strokeWidth={2} />
        </button>
        <span className={['w-2 h-2 rounded-full shrink-0', statusClass].join(' ')} />
        <span className="text-[12px] leading-[14px] font-semibold text-fg">AI Activity</span>
        <div className="flex-1" />
        {/* Segmented control — matches app-wide pill style */}
        <div className="h-7 flex items-center bg-elevated rounded-md p-0.5 gap-0.5">
          {(['feed', 'terminal'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={[
                'text-[11px] px-3 py-1 rounded-md capitalize transition-colors',
                view === v
                  ? 'bg-surface text-fg border border-border'
                  : 'text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Feed / Terminal */}
      {view === 'feed' ? <EventFeed events={events} /> : <EventTerminal events={events} />}

      {/* Waiting banner (footer) */}
      {waitingMessage && (
        <div className="w-full bg-elevated border-t border-border py-3.5 px-3 flex items-center justify-center gap-2 shrink-0 text-fg-muted">
          <Hand size={14} strokeWidth={2} />
          <span className="text-[12px] font-semibold">{waitingMessage}</span>
        </div>
      )}
    </div>
  )
}
