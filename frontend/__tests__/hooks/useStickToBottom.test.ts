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
