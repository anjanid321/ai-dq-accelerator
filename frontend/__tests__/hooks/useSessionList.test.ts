import { renderHook, act } from '@testing-library/react'
import { useSessionList } from '@/hooks/useSessionList'

beforeEach(() => localStorage.clear())

it('starts empty', () => {
  const { result } = renderHook(() => useSessionList())
  expect(result.current.sessions).toEqual([])
})

it('addSession prepends to list and persists', () => {
  const { result } = renderHook(() => useSessionList())
  act(() => result.current.addSession({ id: 'abc', filename: 'test.csv', createdAt: '2026-01-01' }))
  expect(result.current.sessions[0].id).toBe('abc')
  expect(JSON.parse(localStorage.getItem('dq_sessions')!)[0].id).toBe('abc')
})

it('removeSession removes by id', () => {
  const { result } = renderHook(() => useSessionList())
  act(() => result.current.addSession({ id: 'abc', filename: 'test.csv', createdAt: '2026-01-01' }))
  act(() => result.current.removeSession('abc'))
  expect(result.current.sessions).toEqual([])
})
