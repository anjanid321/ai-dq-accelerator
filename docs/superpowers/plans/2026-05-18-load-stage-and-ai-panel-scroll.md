# Load Stage + AI Panel Auto-Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Round 2 / Stage 3 changes — a retokenized Load stage (UDig-orange spinner, foundation tokens, refreshed copy) and a follow-mode AI Panel with a scroll-to-latest pill that surfaces when the user is scrolled up.

**Architecture:** One shared `useStickToBottom(ref, itemCount, threshold?)` hook owns the pin/unread/scroll state. Both `EventFeed` and `EventTerminal` attach a ref to their existing `overflow-y-auto` scroll container, consume the hook, and render a shared presentational `ScrollToLatestPill` floating inside that container. `LoadingStage` is a five-minute retokenize that doesn't touch any of the above.

**Tech Stack:** Next 16, React 19, TypeScript 5, Tailwind 3.4 (foundation tokens — `border-brand-primary`, `text-fg-muted`, `bg-brand-accent`, `text-on-brand`), lucide-react, Jest 30 + ts-jest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-18-load-stage-and-ai-panel-scroll.md` plus Figma frames `117:209` (Load Default), `118:239` (Pill 3 new), `118:293` (Pill Scroll to bottom) on page `02 — Foundation` of `gsnW43uSpvdLpwandZM8Zx`.

---

## File Structure

```
frontend/
  components/
    ai-panel/
      AIPanel.tsx                 # UNCHANGED
      EventFeed.tsx               # MODIFY — wire useStickToBottom, render pill
      EventTerminal.tsx           # MODIFY — replace unconditional scroll, render pill
      ScrollToLatestPill.tsx      # NEW — shared presentational pill
    stages/
      LoadingStage.tsx            # MODIFY — retokenize spinner + copy + a11y
  hooks/
    useStickToBottom.ts           # NEW — pin/unread/scroll state hook
  __tests__/
    hooks/
      useStickToBottom.test.ts    # NEW
    components/
      ai-panel/
        ScrollToLatestPill.test.tsx  # NEW
        EventFeed.test.tsx           # NEW — integration (hook ↔ pill ↔ feed)
    stages/
      LoadingStage.test.tsx          # NEW — small a11y + token assertion
```

Path alias `@/` resolves to `frontend/`. Tailwind content glob already includes `./hooks/` and `./components/`.

Commit cadence — five commits, one per phase:
1. **Load stage retokenize** (Phase 0)
2. **`useStickToBottom` hook** (Phase 1)
3. **`ScrollToLatestPill` component** (Phase 2)
4. **`EventFeed` integration** (Phase 3)
5. **`EventTerminal` integration** (Phase 4)

Phase 5 is a verification + optional tag step.

---

## Phase 0 — Load stage retokenize

Five-minute change. Independent of the AI panel work; can ship on its own.

### Task 0.1: Write the failing test

**Files:**
- Create: `frontend/__tests__/stages/LoadingStage.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/stages/LoadingStage.test.tsx
import { render, screen } from '@testing-library/react'
import { LoadingStage } from '@/components/stages/LoadingStage'

describe('LoadingStage', () => {
  it('renders the loading copy with a real ellipsis character', () => {
    render(<LoadingStage />)
    expect(screen.getByText('Loading your dataset…')).toBeInTheDocument()
  })

  it('exposes the spinner as an aria-live status with the brand-primary border', () => {
    render(<LoadingStage />)
    const spinner = screen.getByRole('status', { name: /loading/i })
    expect(spinner.classList.contains('border-brand-primary')).toBe(true)
    expect(spinner.classList.contains('border-t-transparent')).toBe(true)
    expect(spinner.classList.contains('animate-spin')).toBe(true)
  })

  it('uses the foundation fg-muted token on the wrapper, not the legacy text-text-muted', () => {
    const { container } = render(<LoadingStage />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.classList.contains('text-fg-muted')).toBe(true)
    expect(wrapper.classList.contains('text-text-muted')).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/stages/LoadingStage.test.tsx
```

Expected: FAIL — the current `LoadingStage` uses `text-text-muted` and `border-indigo`, and lacks a `role="status"` on the spinner.

### Task 0.2: Retokenize `LoadingStage.tsx`

**Files:**
- Modify: `frontend/components/stages/LoadingStage.tsx` (full rewrite — 11 lines)

- [ ] **Step 1: Replace the file contents**

```tsx
// frontend/components/stages/LoadingStage.tsx
export function LoadingStage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-fg-muted">
      <div
        role="status"
        aria-label="Loading"
        className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"
      />
      <div className="text-sm">Loading your dataset…</div>
    </div>
  )
}
```

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/stages/LoadingStage.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit Phase 0**

```bash
git add frontend/components/stages/LoadingStage.tsx \
        frontend/__tests__/stages/LoadingStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(load): retokenize LoadingStage to foundation palette

- Spinner ring: border-indigo (legacy) → border-brand-primary (UDig
  orange via token; theme-swaps to Clayton navy under Clayton).
- Wrapper text: text-text-muted (legacy) → text-fg-muted.
- Copy: 'Uploading and loading your dataset...' → 'Loading your
  dataset…' (real ellipsis char).
- a11y: spinner gains role="status" + aria-label="Loading".
EOF
)"
```

---

## Phase 1 — `useStickToBottom` hook

Shared state machine. Both AI panel views consume it.

### Task 1.1: Write the failing test

**Files:**
- Create: `frontend/__tests__/hooks/useStickToBottom.test.ts`

- [ ] **Step 1: Write the test**

```ts
// frontend/__tests__/hooks/useStickToBottom.test.ts
import { renderHook, act } from '@testing-library/react'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import type { RefObject } from 'react'

interface Geometry {
  scrollHeight: number
  clientHeight: number
  scrollTop?: number
}

function makeContainer(g: Geometry): HTMLElement {
  const el = document.createElement('div')
  let _scrollTop = g.scrollTop ?? 0
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => g.clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => _scrollTop,
    set: (v: number) => { _scrollTop = v },
  })
  el.scrollTo = jest.fn((opts: ScrollToOptions) => {
    if (typeof opts?.top === 'number') _scrollTop = opts.top
  }) as unknown as HTMLElement['scrollTo']
  return el
}

function asRef<T extends HTMLElement>(el: T): RefObject<T | null> {
  return { current: el }
}

describe('useStickToBottom', () => {
  it('starts pinned when content fits inside the viewport', () => {
    const c = makeContainer({ scrollHeight: 100, clientHeight: 400 })
    const ref = asRef(c)
    const { result } = renderHook(() => useStickToBottom(ref, 0))
    expect(result.current.pinned).toBe(true)
    expect(result.current.unreadCount).toBe(0)
  })

  it('starts lifted when content overflows and scrollTop is at the top', () => {
    const c = makeContainer({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
    const ref = asRef(c)
    const { result } = renderHook(() => useStickToBottom(ref, 5))
    expect(result.current.pinned).toBe(false)
  })

  it('treats positions within the 24px threshold as pinned', () => {
    const c = makeContainer({ scrollHeight: 1000, clientHeight: 400, scrollTop: 580 })
    // distance from bottom = 1000 - 580 - 400 = 20 <= 24 → pinned
    const ref = asRef(c)
    const { result } = renderHook(() => useStickToBottom(ref, 5))
    expect(result.current.pinned).toBe(true)
  })

  it('treats positions beyond the threshold as lifted', () => {
    const c = makeContainer({ scrollHeight: 1000, clientHeight: 400, scrollTop: 500 })
    // distance from bottom = 1000 - 500 - 400 = 100 > 24 → lifted
    const ref = asRef(c)
    const { result } = renderHook(() => useStickToBottom(ref, 5))
    expect(result.current.pinned).toBe(false)
  })

  it('increments unreadCount when items arrive while lifted', () => {
    const c = makeContainer({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
    const ref = asRef(c)
    const { result, rerender } = renderHook(({ n }) => useStickToBottom(ref, n), {
      initialProps: { n: 5 },
    })
    expect(result.current.pinned).toBe(false)
    expect(result.current.unreadCount).toBe(0)

    rerender({ n: 7 })
    expect(result.current.unreadCount).toBe(2)

    rerender({ n: 8 })
    expect(result.current.unreadCount).toBe(3)
  })

  it('does not increment unreadCount when items arrive while pinned', () => {
    const c = makeContainer({ scrollHeight: 100, clientHeight: 400 })
    const ref = asRef(c)
    const { result, rerender } = renderHook(({ n }) => useStickToBottom(ref, n), {
      initialProps: { n: 0 },
    })
    expect(result.current.pinned).toBe(true)

    rerender({ n: 3 })
    expect(result.current.unreadCount).toBe(0)
    expect(c.scrollTo).toHaveBeenCalled()
  })

  it('resets pinned + unreadCount when scrollToBottom is invoked', () => {
    const c = makeContainer({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
    const ref = asRef(c)
    const { result, rerender } = renderHook(({ n }) => useStickToBottom(ref, n), {
      initialProps: { n: 5 },
    })
    rerender({ n: 8 })
    expect(result.current.unreadCount).toBe(3)

    act(() => result.current.scrollToBottom())
    expect(result.current.pinned).toBe(true)
    expect(result.current.unreadCount).toBe(0)
    expect(c.scrollTo).toHaveBeenCalled()
  })

  it('resets unreadCount when the user manually scrolls back to the bottom', () => {
    const c = makeContainer({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
    const ref = asRef(c)
    const { result, rerender } = renderHook(({ n }) => useStickToBottom(ref, n), {
      initialProps: { n: 5 },
    })
    rerender({ n: 8 })
    expect(result.current.unreadCount).toBe(3)

    // Simulate user dragging scrollbar to the bottom and the browser firing a scroll event.
    c.scrollTop = 600 // distance = 1000 - 600 - 400 = 0 → pinned
    act(() => c.dispatchEvent(new Event('scroll')))
    expect(result.current.pinned).toBe(true)
    expect(result.current.unreadCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/hooks/useStickToBottom.test.ts
```

Expected: FAIL with "Cannot find module '@/hooks/useStickToBottom'".

### Task 1.2: Implement `useStickToBottom`

**Files:**
- Create: `frontend/hooks/useStickToBottom.ts`

- [ ] **Step 1: Write the hook**

```ts
// frontend/hooks/useStickToBottom.ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export interface StickyState {
  pinned: boolean
  unreadCount: number
  scrollToBottom: () => void
}

/**
 * Follow-mode scroll state for a container with appending content (chat panel,
 * log stream, etc.). Tracks whether the user is "pinned" to the bottom and a
 * count of items that arrived while they were not.
 *
 * - Pinned: scrollTop within `threshold` px of the bottom. New items auto-scroll
 *   the container down. unreadCount stays 0.
 * - Lifted: user has scrolled up. Auto-scroll paused. unreadCount increments
 *   on every item-count change (one increment per appended item).
 * - scrollToBottom(): programmatically scroll to bottom, re-pin, reset unread.
 */
export function useStickToBottom(
  containerRef: RefObject<HTMLElement | null>,
  itemCount: number,
  threshold: number = 24,
): StickyState {
  const [pinned, setPinned] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const lastItemCountRef = useRef(itemCount)
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned

  // Scroll listener: track pin state.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function evaluate() {
      const node = containerRef.current
      if (!node) return
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= threshold
      if (atBottom) {
        setPinned(true)
        setUnreadCount(0)
      } else {
        setPinned(false)
      }
    }

    evaluate() // initial state on mount
    el.addEventListener('scroll', evaluate)
    return () => el.removeEventListener('scroll', evaluate)
  }, [containerRef, threshold])

  // Item count effect: scroll if pinned, otherwise accumulate unread.
  useEffect(() => {
    const delta = itemCount - lastItemCountRef.current
    lastItemCountRef.current = itemCount
    if (delta <= 0) return

    const el = containerRef.current
    if (!el) return

    if (pinnedRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      setUnreadCount((c) => c + delta)
    }
  }, [itemCount, containerRef])

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setPinned(true)
    setUnreadCount(0)
  }, [containerRef])

  return { pinned, unreadCount, scrollToBottom }
}
```

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/hooks/useStickToBottom.test.ts
```

Expected: 8/8 pass.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit Phase 1**

```bash
git add frontend/hooks/useStickToBottom.ts \
        frontend/__tests__/hooks/useStickToBottom.test.ts
git commit -m "$(cat <<'EOF'
feat(ai-panel): add useStickToBottom hook for follow-mode scrolling

Returns { pinned, unreadCount, scrollToBottom }. Tracks whether the
host scroll container is within `threshold` (default 24px) of the
bottom; auto-scrolls when new items arrive while pinned; accumulates
an unread counter while lifted. scrollToBottom() programmatically
re-pins and resets unread.

Foundation for the AI panel's new scroll-to-latest affordance —
EventFeed and EventTerminal both consume it next.
EOF
)"
```

---

## Phase 2 — `ScrollToLatestPill` component

Tiny presentational pill. No scroll logic — that's the hook's job.

### Task 2.1: Write the failing test

**Files:**
- Create: `frontend/__tests__/components/ai-panel/ScrollToLatestPill.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/components/ai-panel/ScrollToLatestPill.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ScrollToLatestPill } from '@/components/ai-panel/ScrollToLatestPill'

describe('ScrollToLatestPill', () => {
  it('renders "Scroll to bottom" when unreadCount is 0', () => {
    render(<ScrollToLatestPill unreadCount={0} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /scroll to bottom/i })).toBeInTheDocument()
  })

  it('renders "<N> new" when unreadCount is positive', () => {
    render(<ScrollToLatestPill unreadCount={3} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /3 new/i })).toBeInTheDocument()
  })

  it('uses the primary-button token styling (bg-brand-accent + text-on-brand)', () => {
    render(<ScrollToLatestPill unreadCount={0} onClick={() => {}} />)
    const btn = screen.getByRole('button')
    expect(btn.classList.contains('bg-brand-accent')).toBe(true)
    expect(btn.classList.contains('text-on-brand')).toBe(true)
  })

  it('declares an aria-live region so the unread count is announced', () => {
    render(<ScrollToLatestPill unreadCount={3} onClick={() => {}} />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-live')).toBe('polite')
  })

  it('fires onClick when activated', () => {
    const onClick = jest.fn()
    render(<ScrollToLatestPill unreadCount={2} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/components/ai-panel/ScrollToLatestPill.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/ai-panel/ScrollToLatestPill'".

### Task 2.2: Implement `ScrollToLatestPill`

**Files:**
- Create: `frontend/components/ai-panel/ScrollToLatestPill.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/components/ai-panel/ScrollToLatestPill.test.tsx
```

Expected: 5/5 pass.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit Phase 2**

```bash
git add frontend/components/ai-panel/ScrollToLatestPill.tsx \
        frontend/__tests__/components/ai-panel/ScrollToLatestPill.test.tsx
git commit -m "$(cat <<'EOF'
feat(ai-panel): add ScrollToLatestPill component

Floating primary-styled pill (bg-brand-accent + text-on-brand) anchored
bottom-center of the host scroll container via absolute positioning.
Label flips between '<N> new' and 'Scroll to bottom' based on
unreadCount. Lucide ArrowDown icon. aria-live=polite so the count is
announced by screen readers.

Mounted by EventFeed/EventTerminal in the next phases.
EOF
)"
```

---

## Phase 3 — Wire into `EventFeed`

Attach a ref to the existing scroll container, consume the hook, render the pill.

### Task 3.1: Write the integration test

**Files:**
- Create: `frontend/__tests__/components/ai-panel/EventFeed.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// frontend/__tests__/components/ai-panel/EventFeed.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { EventFeed } from '@/components/ai-panel/EventFeed'
import type { AIEvent } from '@/hooks/useAIStream'

function ev(event: AIEvent['event'], extras: Partial<AIEvent> = {}): AIEvent {
  return { event, ts: Date.now(), ...extras } as AIEvent
}

describe('EventFeed', () => {
  it('renders a card per event', () => {
    const events: AIEvent[] = [
      ev('tool_call', { tool: 'read_file' }),
      ev('tool_result', { tool: 'read_file', preview: '47 columns' }),
      ev('thinking', { content: 'Validating column types.' }),
    ]
    render(<EventFeed events={events} />)
    expect(screen.getByText('TOOL CALL')).toBeInTheDocument()
    expect(screen.getByText('RESULT')).toBeInTheDocument()
    expect(screen.getByText('THINKING')).toBeInTheDocument()
  })

  it('does not show the scroll-to-latest pill while pinned to the bottom', () => {
    // jsdom default geometry: scrollHeight === clientHeight === 0 → pinned.
    const events: AIEvent[] = [ev('tool_call', { tool: 'read_file' })]
    render(<EventFeed events={events} />)
    expect(screen.queryByRole('button', { name: /scroll to bottom|new/i })).toBeNull()
  })

  it('shows the pill once the user scrolls up past the threshold', () => {
    const events: AIEvent[] = [ev('tool_call', { tool: 'read_file' })]
    const { container } = render(<EventFeed events={events} />)
    const scroller = container.querySelector('[data-testid="event-feed-scroller"]') as HTMLElement

    // Stage a lifted geometry then fire scroll.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => {},
    })
    fireEvent.scroll(scroller)

    expect(screen.getByRole('button', { name: /scroll to bottom/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npx jest __tests__/components/ai-panel/EventFeed.test.tsx
```

Expected: FAIL — the existing `EventFeed` doesn't have the `data-testid` scroll container or render the pill yet.

### Task 3.2: Rewire `EventFeed`

**Files:**
- Modify: `frontend/components/ai-panel/EventFeed.tsx`

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/components/ai-panel/EventFeed.tsx
'use client'
import { useRef } from 'react'
import type { AIEvent } from '@/hooks/useAIStream'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { ScrollToLatestPill } from './ScrollToLatestPill'

function formatTimestamp(ts: string | number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface CardProps {
  event: AIEvent
  highlighted: boolean
}

const cardBase = 'bg-surface rounded-lg p-3 flex flex-col gap-1.5 border min-w-0 overflow-hidden'
const bodyClass = 'text-[11px] font-mono text-fg-muted leading-relaxed whitespace-pre-wrap break-all'
const badgeBase = 'inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded uppercase tracking-wide shrink-0'
const toolNameClass = 'text-[10px] font-mono text-fg truncate min-w-0'
const timestampClass = 'text-[10px] text-fg-muted ml-auto shrink-0 tabular-nums'

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
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
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
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
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
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
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
        {ev.ts != null && <span className={timestampClass}>{formatTimestamp(ev.ts)}</span>}
      </div>
    </div>
  )
}

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

export function EventFeed({ events }: { events: AIEvent[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const { pinned, unreadCount, scrollToBottom } = useStickToBottom(scrollerRef, events.length)

  if (events.length === 0) return <div className="flex-1" />

  const lastIndex = events.length - 1
  return (
    <div
      ref={scrollerRef}
      data-testid="event-feed-scroller"
      className="relative flex-1 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-2"
    >
      {events.map((ev, i) => (
        <EventCard key={i} event={ev} highlighted={i === lastIndex} />
      ))}
      {!pinned && <ScrollToLatestPill unreadCount={unreadCount} onClick={scrollToBottom} />}
    </div>
  )
}
```

Changes vs. the current file:
- Added `useRef`, `useStickToBottom`, `ScrollToLatestPill` imports.
- Outer div gains `ref={scrollerRef}`, `data-testid`, and `relative` (so the absolutely-positioned pill anchors to it).
- Pill rendered as the last child when `!pinned`.

- [ ] **Step 2: Verify tests pass**

```bash
cd frontend && npx jest __tests__/components/ai-panel/EventFeed.test.tsx __tests__/components/ai-panel/ScrollToLatestPill.test.tsx __tests__/hooks/useStickToBottom.test.ts
```

Expected: all green (3 + 5 + 8 = 16 assertions passing).

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit Phase 3**

```bash
git add frontend/components/ai-panel/EventFeed.tsx \
        frontend/__tests__/components/ai-panel/EventFeed.test.tsx
git commit -m "$(cat <<'EOF'
feat(ai-panel): wire follow-mode + scroll-to-latest pill into EventFeed

Attaches a ref to the existing overflow-y-auto cards container,
consumes useStickToBottom for pin/unread/scroll state, and renders the
ScrollToLatestPill as the last child when the user is lifted.

Behavior preserved: same card rendering, same empty-state filler when
events.length === 0. New: relative positioning on the scroll container
so the pill can anchor bottom-center, and a data-testid hook for
integration tests.
EOF
)"
```

---

## Phase 4 — Wire into `EventTerminal`

Same shape as Phase 3 — replaces the existing unconditional `scrollIntoView()` behavior with the hook-driven follow mode.

### Task 4.1: Rewire `EventTerminal`

**Files:**
- Modify: `frontend/components/ai-panel/EventTerminal.tsx` (full rewrite)

- [ ] **Step 1: Replace the file's contents**

```tsx
// frontend/components/ai-panel/EventTerminal.tsx
'use client'

import { useRef } from 'react'
import type { AIEvent } from '@/hooks/useAIStream'
import { useStickToBottom } from '@/hooks/useStickToBottom'
import { ScrollToLatestPill } from './ScrollToLatestPill'

// Token-driven, tinted-at-15-alpha so glyphs read clearly on the white surface.
const GLYPH: Record<string, string> = { tool_call: '▶', tool_result: '✓', thinking: '~', done: '■' }
const GLYPH_COLOR: Record<string, string> = {
  tool_call:   'text-accent-indigo-deep',
  tool_result: 'text-success-deep',
  thinking:    'text-accent-purple-deep',
  done:        'text-fg-muted',
}

function formatTimestamp(ts: unknown): string {
  if (ts == null) return '--'
  const ms = typeof ts === 'number' ? ts : Date.parse(String(ts))
  if (Number.isNaN(ms)) return '--'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function eventBody(ev: AIEvent): string {
  if (ev.event === 'thinking') return String(ev.content ?? ev.text ?? '')
  if (ev.event === 'tool_call') return JSON.stringify(ev.input ?? ev.params ?? {}, null, 0)
  if (ev.event === 'tool_result') return String(ev.preview ?? '')
  return JSON.stringify(ev.params ?? ev.result ?? {}, null, 0)
}

export function EventTerminal({ events }: { events: AIEvent[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const { pinned, unreadCount, scrollToBottom } = useStickToBottom(scrollerRef, events.length)

  return (
    <div
      ref={scrollerRef}
      data-testid="event-terminal-scroller"
      className="relative flex-1 overflow-y-auto overflow-x-hidden p-3 font-mono text-[11px] leading-relaxed text-fg"
    >
      {events.map((ev, i) => {
        const glyphCls = GLYPH_COLOR[ev.event] ?? 'text-fg-muted'
        const glyph = GLYPH[ev.event] ?? '?'
        const body = eventBody(ev)
        const isThinking = ev.event === 'thinking'
        return (
          <div key={i} className="break-words">
            <span className="text-fg-muted">[{formatTimestamp(ev.ts)}]</span>{' '}
            <span className={glyphCls}>{glyph}</span>{' '}
            <span className="text-fg font-semibold">{String(ev.tool ?? ev.event)}</span>
            {body && (
              <div className={`pl-4 break-all whitespace-pre-wrap text-fg-muted ${isThinking ? 'italic' : ''}`}>
                {body}
              </div>
            )}
          </div>
        )
      })}
      <span className="text-fg">█</span>
      {!pinned && <ScrollToLatestPill unreadCount={unreadCount} onClick={scrollToBottom} />}
    </div>
  )
}
```

Changes vs. the current file:
- Dropped the `useEffect` + `bottomRef.current?.scrollIntoView()` (unconditional yank — wrong behavior).
- Dropped the `<div ref={bottomRef} />` sentinel.
- Outer div gains `ref={scrollerRef}`, `data-testid`, and `relative`.
- Pill rendered as the last child when `!pinned`.

- [ ] **Step 2: Run the full AI panel + hook suite**

```bash
cd frontend && npx jest __tests__/components/ai-panel/ __tests__/hooks/useStickToBottom.test.ts __tests__/stages/LoadingStage.test.tsx
```

Expected: all green — no test changes needed for EventTerminal because its tests aren't in scope for this phase (the integration shape is identical to EventFeed and the EventFeed test covers the wire-up pattern; manual smoke covers Terminal).

- [ ] **Step 3: Full test suite + type-check + build**

```bash
cd frontend && npx tsc --noEmit && npx jest && npm run build
```

Expected:
- `tsc`: clean.
- `jest`: pre-existing `useAIStream` failure stays as the only failure; all new tests pass. Baseline going in is 85 passing / 1 failing; expect ~100 passing / 1 failing after Stage 3 lands.
- `npm run build`: succeeds. The home page + workspace pages compile.

- [ ] **Step 4: Commit Phase 4**

```bash
git add frontend/components/ai-panel/EventTerminal.tsx
git commit -m "$(cat <<'EOF'
feat(ai-panel): wire follow-mode + scroll-to-latest pill into EventTerminal

Replaces the unconditional bottomRef.scrollIntoView() useEffect with
the same useStickToBottom + ScrollToLatestPill wiring EventFeed uses.

User benefit: scrolling up to read earlier output now stays in place
instead of being yanked back to the bottom on every new event, and a
pill ('<N> new' / 'Scroll to bottom') gives a one-click way back.
EOF
)"
```

---

## Phase 5 — Verification

No code changes. Walk through the design in a running dev server, then optionally tag.

### Task 5.1: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Walk through the scenarios**

1. **Load stage retokenize.** Upload a fresh CSV. While the workflow is in `LOADING`, the workspace shows the centered UDig-orange ring spinner + "Loading your dataset…" copy. Append `?client=clayton` to the URL — the spinner ring renders in Clayton navy.

2. **AI panel pinned (default).** Stay scrolled to the bottom of the Feed/Terminal. New events stream in and the panel smoothly follows. No pill visible.

3. **AI panel lifted (no new).** Scroll up inside the panel before any new events arrive. The pill appears bottom-center with `↓ Scroll to bottom`. Clicking it smooth-scrolls to the bottom and the pill disappears.

4. **AI panel lifted (with unread).** Scroll up, then wait for new events. The pill's label flips to `↓ 1 new`, `↓ 2 new`, etc. as events arrive. Manually scrolling back to the bottom resets the count and hides the pill; clicking the pill does the same.

5. **Feed ↔ Terminal switch.** Toggle the segmented control while pinned — both views stay pinned. Scroll up in one view, switch to the other, scroll position re-evaluates from the new container.

6. **Empty panel.** Open a session before any events stream — no pill, no auto-scroll spinning.

7. **Pre-existing chrome unchanged.** Collapse/expand the panel, drag the resize handle — confirm those still work; the pill stays inside the panel even when collapsed-then-expanded.

- [ ] **Step 3: (optional) Tag `load-stage-v1` when verified**

```bash
git tag -a load-stage-v1 -m "$(cat <<'EOF'
Round 2 Stage 3 — Load stage + AI Panel auto-scroll

Retokenizes LoadingStage to the foundation palette (brand-primary
spinner, fg-muted copy, real-ellipsis character, role=status a11y).

Introduces useStickToBottom (pinned / unreadCount / scrollToBottom)
and a shared ScrollToLatestPill. Wires both into EventFeed and
EventTerminal so the AI panel follows new events when the user is
pinned to the bottom and surfaces a primary-styled pill ('<N> new' or
'Scroll to bottom') when they're scrolled up.
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Load stage retokenize | Phase 0 (`LoadingStage.tsx`) |
| Load stage tests | Task 0.1 (`__tests__/stages/LoadingStage.test.tsx`) |
| `useStickToBottom` hook signature | Phase 1 (`hooks/useStickToBottom.ts`) |
| Pinned / Lifted / Unread state machine | Phase 1 + tests in Task 1.1 |
| 24px threshold | Phase 1 default param + Task 1.1 threshold tests |
| Pill style (primary-button shape) | Phase 2 (`ScrollToLatestPill.tsx`) |
| Pill label logic (`<N> new` vs `Scroll to bottom`) | Phase 2 + Task 2.1 |
| Pill placement (bottom-center, absolute inside scroller) | Phase 2 class string + Phase 3/4 `relative` wrapper |
| `aria-live` for unread announcements | Phase 2 + Task 2.1 |
| `EventFeed` integration | Phase 3 |
| `EventTerminal` integration | Phase 4 (replaces existing unconditional scroll) |
| Empty-state behavior | Phase 3 (`if (events.length === 0)` short-circuit preserved) |
| View-switch behavior | Phase 3 + 4 (each view owns its own ref; hook re-evaluates) |
| Test scenarios from spec's Testing strategy | Tasks 0.1, 1.1, 2.1, 3.1 |

**Placeholder scan:** every step has executable code or an exact command + expected output. No TBDs, no "similar to Task N", no references to undefined types or functions.

**Type consistency:**
- `StickyState` is the same shape across the hook (defined in Phase 1) and every consumer (Phase 3, 4).
- The pill's `Props` (`unreadCount: number`, `onClick: () => void`) match how `EventFeed` and `EventTerminal` invoke it in Phases 3 + 4.
- `useStickToBottom(ref, itemCount, threshold?)` is invoked with `events.length` in both wirings — matches the test stubs in Task 1.1.

**Commit count:** five commits, matching the cadence of Stage 1 (Rules) and Stage 2 (Sessions). Each commit is independently testable / revertible.
