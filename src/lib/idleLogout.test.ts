import { describe, expect, it } from 'vitest'
import { IDLE_LIMIT_DIRTY_MS, IDLE_LIMIT_MS, idleState } from './idleLogout'

describe('idleState', () => {
  it('warns in the last minute and signs out at the limit', () => {
    expect(idleState(0, IDLE_LIMIT_MS - 60_001)).toBe('active')
    expect(idleState(0, IDLE_LIMIT_MS - 60_000)).toBe('warn')
    expect(idleState(0, IDLE_LIMIT_MS)).toBe('out')
  })

  it('waits longer while a form has unsaved typing', () => {
    expect(idleState(0, IDLE_LIMIT_MS, IDLE_LIMIT_DIRTY_MS)).toBe('active')
    expect(idleState(0, IDLE_LIMIT_DIRTY_MS, IDLE_LIMIT_DIRTY_MS)).toBe('out')
  })
})
