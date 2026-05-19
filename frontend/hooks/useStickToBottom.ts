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
