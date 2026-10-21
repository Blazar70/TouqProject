import { describe, expect, it } from 'vitest'
import { pickableBranches, startingBranch, worksAt } from './branchChoice'

const main = { id: 'main', active: true }
const north = { id: 'north', active: true }
const east = { id: 'east', active: true }
const closed = { id: 'closed', active: false }
const all = [main, north, east, closed]

describe('pickableBranches', () => {
  it('whole-clinic manager gets every open branch', () => {
    expect(pickableBranches(all, [], 'manager')).toEqual([main, north, east])
  })
  it('members get their open branches only', () => {
    expect(pickableBranches(all, ['north', 'closed'], 'doctor')).toEqual([north])
    expect(pickableBranches(all, ['east'], 'manager')).toEqual([east])
  })
  it('non-manager with no rows gets nothing', () => {
    expect(pickableBranches(all, [], 'doctor')).toEqual([])
  })
})

describe('startingBranch', () => {
  it('one branch is chosen silently', () => {
    expect(startingBranch([north], null, [])).toEqual({ branchId: 'north', ask: false })
  })
  it('no branch: nothing to ask', () => {
    expect(startingBranch([], 'north', ['north'])).toEqual({ branchId: null, ask: false })
  })
  it('2+ branches ask, pre-selecting this device first, then the profile', () => {
    expect(startingBranch([main, north], null, ['north', 'main'])).toEqual({ branchId: 'north', ask: true })
    expect(startingBranch([main, north], null, [null, 'main'])).toEqual({ branchId: 'main', ask: true })
  })
  it('already picked in this tab: no question', () => {
    expect(startingBranch([main, north], 'north', ['main'])).toEqual({ branchId: 'north', ask: false })
  })
  it('remembered branch closed or removed: ask again', () => {
    expect(startingBranch([main, north], 'east', ['east', 'east'])).toEqual({ branchId: null, ask: true })
  })
})

describe('worksAt', () => {
  it('members work at their branches only', () => {
    expect(worksAt({ clinic_role: 'doctor', staff_branches: [{ branch_id: 'north' }] }, 'north')).toBe(true)
    expect(worksAt({ clinic_role: 'doctor', staff_branches: [{ branch_id: 'north' }] }, 'main')).toBe(false)
  })
  it('a manager with no rows works everywhere; others with no rows nowhere', () => {
    expect(worksAt({ clinic_role: 'manager', staff_branches: [] }, 'east')).toBe(true)
    expect(worksAt({ clinic_role: 'doctor', staff_branches: [] }, 'east')).toBe(false)
  })
})
