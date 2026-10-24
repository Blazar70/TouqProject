import { describe, expect, it } from 'vitest'
import { getsAlert, getsInpatientAlert } from '../../supabase/functions/_shared/alertRecipients'

const atMain = { doctor_id: 'layla', branch_id: 'main' }
const unassignedAtMain = { doctor_id: null, branch_id: 'main' }

describe('getsAlert', () => {
  it('doctors get only their own appointments', () => {
    expect(getsAlert({ id: 'layla', clinic_role: 'doctor', branchIds: ['main'] }, atMain)).toBe(true)
    expect(getsAlert({ id: 'omar', clinic_role: 'doctor', branchIds: ['main'] }, atMain)).toBe(false)
    expect(getsAlert({ id: 'omar', clinic_role: 'doctor', branchIds: ['main'] }, unassignedAtMain)).toBe(false)
  })

  it('others get their branches; whole-clinic managers get all', () => {
    expect(getsAlert({ id: 'reem', clinic_role: 'receptionist', branchIds: ['main'] }, unassignedAtMain)).toBe(true)
    expect(getsAlert({ id: 'nina', clinic_role: 'nurse', branchIds: ['east'] }, atMain)).toBe(false)
    expect(getsAlert({ id: 'sara', clinic_role: 'manager', branchIds: [] }, atMain)).toBe(true)
    expect(getsAlert({ id: 'east.mgr', clinic_role: 'manager', branchIds: ['east'] }, atMain)).toBe(false)
  })
})

describe('getsInpatientAlert', () => {
  it('reaches the doctors and nurses of the branch the pet is at, nobody else', () => {
    expect(getsInpatientAlert({ id: 'nina', clinic_role: 'nurse', branchIds: ['east'] }, 'east')).toBe(true)
    expect(getsInpatientAlert({ id: 'omar', clinic_role: 'doctor', branchIds: ['main', 'east'] }, 'east')).toBe(true)
    expect(getsInpatientAlert({ id: 'layla', clinic_role: 'doctor', branchIds: ['main'] }, 'east')).toBe(false)
    expect(getsInpatientAlert({ id: 'reem', clinic_role: 'receptionist', branchIds: ['east'] }, 'east')).toBe(false)
    expect(getsInpatientAlert({ id: 'sara', clinic_role: 'manager', branchIds: [] }, 'east')).toBe(false)
  })
})
