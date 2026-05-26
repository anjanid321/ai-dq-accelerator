'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Hand, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { AIEvent } from '@/hooks/useAIStream'
import { EventFeed } from './EventFeed'
import { EventTerminal } from './EventTerminal'

interface Props {
  events: AIEvent[]
  isStreaming: boolean
  waitingMessage?: string
}

const COLLAPSED_STORAGE_KEY = 'ai-panel-collapsed'
const WIDTH_STORAGE_KEY = 'ai-panel-width'
const DEFAULT_WIDTH = 340

/** Minimum width the Rules-stage main area needs without filters/buttons colliding. */
const MIN_MAIN_WIDTH = 600
/** Width of the left Stepper rail. */
const STEPPER_WIDTH = 220
/** Computed max AI panel width for the current viewport. */
function maxWidthFor(viewportWidth: number): number {
  return Math.max(DEFAULT_WIDTH, viewportWidth - STEPPER_WIDTH - MIN_MAIN_WIDTH)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/** Format milliseconds as "Xs" or "1m 12s" or "2h 4m". */
function formatRunDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const remS = s % 60
  if (m < 60) return remS === 0 ? `${m}m` : `${m}m ${remS}s`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM === 0 ? `${h}h` : `${h}h ${remM}m`
}

export function AIPanel({ events, isStreaming, waitingMessage }: Props) {
  const [view, setView] = useState<'feed' | 'terminal'>('feed')
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH)
  const dragStartRef = useRef<{ pointerX: number; width: number } | null>(null)

  // Restore preferences
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1') setCollapsed(true)
    const w = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
    if (Number.isFinite(w) && w >= DEFAULT_WIDTH) {
      setWidth(clamp(w, DEFAULT_WIDTH, maxWidthFor(window.innerWidth)))
    }
  }, [])

  // Persist preferences
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0')
  }, [collapsed])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
  }, [width])

  // Clamp width when viewport shrinks
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => {
      setWidth((prev) => clamp(prev, DEFAULT_WIDTH, maxWidthFor(window.innerWidth)))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Drag handlers
  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragStartRef.current
    if (!drag) return
    const delta = drag.pointerX - e.clientX // dragging left = wider panel
    const nextWidth = clamp(drag.width + delta, DEFAULT_WIDTH, maxWidthFor(window.innerWidth))
    setWidth(nextWidth)
  }, [])
  const onPointerUp = useCallback(() => {
    dragStartRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [onPointerMove])
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStartRef.current = { pointerX: e.clientX, width }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }, [onPointerMove, onPointerUp, width])

  // Running timer — starts when isStreaming flips to true, resets when it flips false.
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [runElapsedMs, setRunElapsedMs] = useState(0)
  useEffect(() => {
    if (isStreaming && runStartedAt === null) {
      setRunStartedAt(Date.now())
      setRunElapsedMs(0)
    } else if (!isStreaming && runStartedAt !== null) {
      setRunStartedAt(null)
      setRunElapsedMs(0)
    }
  }, [isStreaming, runStartedAt])
  useEffect(() => {
    if (runStartedAt === null) return
    const id = setInterval(() => setRunElapsedMs(Date.now() - runStartedAt), 1000)
    return () => clearInterval(id)
  }, [runStartedAt])

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
    <div
      className="bg-surface border-l border-border flex flex-col shrink-0 h-full relative"
      style={{ width }}
    >
      {/* Drag handle on the left edge */}
      <div
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize AI activity panel"
        className="absolute top-0 bottom-0 left-0 w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-brand-primary/30 transition-colors z-10"
      />

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
        {/* Segmented control */}
        <div className="h-7 flex items-center bg-elevated rounded-md p-0.5 gap-0.5">
          {(['feed', 'terminal'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={[
                'text-xs px-3 py-1 rounded-md capitalize transition-colors',
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

      {/* Footer — running indicator wins over waiting banner */}
      {isStreaming && runStartedAt !== null ? (
        <div className="w-full bg-elevated border-t border-border py-3 px-3 flex items-center justify-center gap-2 shrink-0 text-fg-muted">
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-success/40 animate-ping" />
            <span className="relative w-2 h-2 rounded-full bg-success" />
          </span>
          <span className="text-[12px] font-semibold">Running · {formatRunDuration(runElapsedMs)}</span>
        </div>
      ) : waitingMessage ? (
        <div className="w-full bg-elevated border-t border-border py-3 px-3 flex items-center justify-center gap-2 shrink-0 text-fg-muted">
          <Hand size={14} strokeWidth={2} />
          <span className="text-[12px] font-semibold">{waitingMessage}</span>
        </div>
      ) : null}
    </div>
  )
}
