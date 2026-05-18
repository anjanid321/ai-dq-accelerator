'use client'
import { useEffect, useState } from 'react'
import type { AIEvent } from '@/hooks/useAIStream'

// ── helpers ────────────────────────────────────────────────────────────────

function tsToMs(ts: string | number): number {
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts // accept seconds-since-epoch too
  const parsed = Date.parse(ts)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

/** Format an elapsed-since-event duration like "3s", "1m 12s", "2h 4m". */
function formatElapsed(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  const remS = s % 60
  if (m < 60) return remS === 0 ? `${m}m ago` : `${m}m ${remS}s ago`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM === 0 ? `${h}h ago` : `${h}h ${remM}m ago`
}

/** Hook that re-renders the consumer every second so elapsed-time labels tick. */
function useTick(intervalMs = 1000): number {
  const [, setNow] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return Date.now()
}

function Elapsed({ ts }: { ts: string | number | undefined }) {
  useTick()
  if (ts == null) return null
  return (
    <span className="text-[10px] text-fg-subtle ml-auto shrink-0 tabular-nums">
      {formatElapsed(Date.now() - tsToMs(ts))}
    </span>
  )
}

// ── Card sub-components ────────────────────────────────────────────────────

interface CardProps {
  event: AIEvent
  highlighted: boolean
}

const cardBase = 'bg-surface rounded-lg p-3 flex flex-col gap-1.5 border min-w-0 overflow-hidden'
const bodyClass = 'text-[11px] font-mono text-fg-muted leading-relaxed whitespace-pre-wrap break-all'
const badgeBase = 'inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide shrink-0'
const toolNameClass = 'text-[10px] font-mono text-fg truncate min-w-0'

function ToolCallCard({ event: ev, highlighted }: CardProps) {
  const body = JSON.stringify(
    (ev.input as object) ?? (ev.params as object) ?? {},
    null,
    0,
  )
    .replace(/^{|}$/g, '')
    .trim()

  return (
    <div className={[cardBase, highlighted ? 'border-accent-indigo ring-1 ring-accent-indigo/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-accent-indigo/15 text-accent-indigo-deep`}>TOOL CALL</span>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        <Elapsed ts={ev.ts} />
      </div>
      {body && <pre className={bodyClass}>{body}</pre>}
    </div>
  )
}

function ResultCard({ event: ev, highlighted }: CardProps) {
  const preview = 'preview' in ev ? String(ev.preview) : ''
  return (
    <div className={[cardBase, highlighted ? 'border-success ring-1 ring-success/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-success/15 text-success-deep`}>RESULT</span>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        <Elapsed ts={ev.ts} />
      </div>
      {preview && <pre className={bodyClass}>{preview}</pre>}
    </div>
  )
}

function ThinkingCard({ event: ev, highlighted }: CardProps) {
  const text = String(ev.content ?? ev.text ?? '')
  return (
    <div className={[cardBase, highlighted ? 'border-accent-purple ring-1 ring-accent-purple/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-accent-purple/15 text-accent-purple-deep`}>THINKING</span>
        <Elapsed ts={ev.ts} />
      </div>
      {text && <p className="text-[11px] italic text-fg-muted leading-relaxed break-words">{text}</p>}
    </div>
  )
}

function DoneCard({ event: ev, highlighted }: CardProps) {
  return (
    <div className={[cardBase, highlighted ? 'border-fg-muted ring-1 ring-fg-muted/40' : 'border-border'].join(' ')}>
      <div className="flex items-center gap-2">
        <span className={`${badgeBase} bg-fg-subtle/15 text-fg-muted`}>DONE</span>
        {ev.tool != null && <span className={toolNameClass}>{String(ev.tool)}</span>}
        <Elapsed ts={ev.ts} />
      </div>
    </div>
  )
}

// ── Card selector ──────────────────────────────────────────────────────────

function EventCard({ event, highlighted }: CardProps) {
  switch (event.event) {
    case 'tool_call':
      return <ToolCallCard event={event} highlighted={highlighted} />
    case 'tool_result':
      return <ResultCard event={event} highlighted={highlighted} />
    case 'thinking':
      return <ThinkingCard event={event} highlighted={highlighted} />
    default:
      return <DoneCard event={event} highlighted={highlighted} />
  }
}

// ── EventFeed ──────────────────────────────────────────────────────────────

export function EventFeed({ events }: { events: AIEvent[] }) {
  if (events.length === 0) return <div className="flex-1" />
  const lastIndex = events.length - 1

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-2">
      {events.map((ev, i) => (
        <EventCard key={i} event={ev} highlighted={i === lastIndex} />
      ))}
    </div>
  )
}
