import { describe, expect, it } from 'vitest'
import { parseStaffLogin, staffChangeError, usernameToEmail, USERNAME_RE } from '../../supabase/functions/_shared/staffRules'
import type { StaffCaller, StaffTarget } from '../../supabase/functions/_shared/staffRules'

const admin: StaffCaller = { id: 'admin', isAdmin: true, branchIds: null }
const manager: StaffCaller = { id: 'mgr', isAdmin: false, branchIds: null }
const branchManager: StaffCaller = { id: 'bmgr', isAdmin: false, branchIds: ['b1'] }
const doctor = (branchIds = ['b1']): StaffTarget => ({ id: 'doc', clinicRole: 'doctor', disabled: false, branchIds })
const managerTarget = (id = 'mgr2'): StaffTarget => ({ id, clinicRole: 'manager', disabled: false, branchIds: [] })

describe('staffChangeError', () => {
  it('lets a manager create and manage staff below manager', () => {
    expect(staffChangeError(manager, null, { action: 'create_staff', clinicRole: 'nurse', branchIds: ['b1'] }, 1)).toBeNull()
    expect(staffChangeError(manager, doctor(), { action: 'set_disabled', disabled: true }, 1)).toBeNull()
    expect(staffChangeError(manager, doctor(), { action: 'set_role', clinicRole: 'receptionist' }, 1)).toBeNull()
  })

  it('keeps managers admin-only', () => {
    expect(staffChangeError(manager, null, { action: 'create_staff', clinicRole: 'manager', branchIds: [] }, 1)).toMatch(/admin/)
    expect(staffChangeError(manager, doctor(), { action: 'set_role', clinicRole: 'manager' }, 1)).toMatch(/admin/)
    expect(staffChangeError(manager, managerTarget(), { action: 'set_disabled', disabled: true }, 2)).toMatch(/admin/)
    expect(staffChangeError(admin, null, { action: 'create_staff', clinicRole: 'manager', branchIds: [] }, 0)).toBeNull()
  })

  it('stops a manager changing their own role, branches or access, but not their details', () => {
    const me = managerTarget('mgr')
    expect(staffChangeError(manager, me, { action: 'set_disabled', disabled: true }, 2)).toMatch(/your own/)
    expect(staffChangeError(manager, me, { action: 'set_role', clinicRole: 'doctor' }, 2)).toMatch(/your own/)
    expect(staffChangeError(manager, me, { action: 'update_staff' }, 1)).toBeNull()
  })

  it('limits a branch manager to their branches', () => {
    expect(staffChangeError(branchManager, doctor(['b2']), { action: 'set_disabled', disabled: true }, 1)).toMatch(/outside/)
    expect(staffChangeError(branchManager, doctor(['b1', 'b2']), { action: 'update_staff' }, 1)).toBeNull()
    expect(staffChangeError(branchManager, doctor(['b1', 'b2']), { action: 'set_branches', branchIds: ['b1'] }, 1)).toMatch(/outside/)
    expect(staffChangeError(branchManager, null, { action: 'create_staff', clinicRole: 'doctor', branchIds: ['b2'] }, 1)).toMatch(/own branches/)
  })

  it('lets only admins change a login', () => {
    expect(staffChangeError(manager, doctor(), { action: 'set_login' }, 1)).toMatch(/admin/)
    expect(staffChangeError(admin, doctor(), { action: 'set_login' }, 1)).toBeNull()
  })

  it('requires a branch for staff below manager', () => {
    expect(staffChangeError(admin, null, { action: 'create_staff', clinicRole: 'doctor', branchIds: [] }, 1)).toMatch(/branch/)
    expect(staffChangeError(admin, doctor(), { action: 'set_branches', branchIds: [] }, 1)).toMatch(/branch/)
  })

  it('never leaves a clinic without an active manager', () => {
    expect(staffChangeError(admin, managerTarget(), { action: 'set_disabled', disabled: true }, 1)).toMatch(/one active manager/)
    expect(staffChangeError(admin, managerTarget(), { action: 'set_role', clinicRole: 'doctor' }, 1)).toMatch(/one active manager/)
    expect(staffChangeError(admin, managerTarget(), { action: 'set_disabled', disabled: true }, 2)).toBeNull()
  })
})

describe('usernames', () => {
  it('accepts the 0047 format only', () => {
    expect(USERNAME_RE.test('dr.ahmed_1')).toBe(true)
    expect(USERNAME_RE.test('Ahmed')).toBe(false)
    expect(USERNAME_RE.test('ab')).toBe(false)
    expect(USERNAME_RE.test('.ahmed')).toBe(false)
    expect(usernameToEmail('ahmed')).toBe('ahmed@staff.touq.invalid')
  })

  it('takes a username or a real email as a new login', () => {
    expect(parseStaffLogin(' Dr.Ahmed ')).toEqual({ email: 'dr.ahmed@staff.touq.invalid', username: 'dr.ahmed' })
    expect(parseStaffLogin('Sara@Clinic.sa')).toEqual({ email: 'sara@clinic.sa', username: null })
    expect(parseStaffLogin('sara@clinic')).toBeNull()
    expect(parseStaffLogin('ahmed@staff.touq.invalid')).toBeNull()
    expect(parseStaffLogin('a b')).toBeNull()
  })
})
