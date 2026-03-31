import { renderHook, act } from '@testing-library/react'
import { useAIStream } from '@/hooks/useAIStream'

class MockEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  close = jest.fn()
  constructor(public url: string) {}
}

let mockInstance: MockEventSource
global.EventSource = jest.fn().mockImplementation((url: string) => {
  mockInstance = new MockEventSource(url)
  return mockInstance
}) as any

it('accumulates events from the SSE stream', () => {
  const { result } = renderHook(() => useAIStream('sess1'))
  act(() => {
    mockInstance.onmessage?.({ data: '{"event":"tool_call","ts":1,"tool":"profile_dataset"}' } as MessageEvent)
  })
  expect(result.current.events).toHaveLength(1)
  expect(result.current.events[0]).toMatchObject({ event: 'tool_call', tool: 'profile_dataset' })
})

it('stops accumulating after done event', () => {
  const { result } = renderHook(() => useAIStream('sess1'))
  act(() => {
    mockInstance.onmessage?.({ data: '{"event":"done"}' } as MessageEvent)
    mockInstance.onmessage?.({ data: '{"event":"tool_call","ts":2,"tool":"x"}' } as MessageEvent)
  })
  expect(result.current.events).toHaveLength(0)
})
