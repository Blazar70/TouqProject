// PDPL right of access (user decision 2026-10-25): everything Touq holds about one owner, as a
// printable report (PrintContext.printReport) and a JSON file with the same rows.
import { supabase } from './supabase'
import type { ReportDoc } from './PrintContext'
import type { TranslationKey } from './i18n/translations'
import { formatDate, formatDateTime, formatIsoDate, formatMoney } from './format'
import { speciesLabel } from './species'

type T = (key: TranslationKey, vars?: Record<string, string>) => string

export async function collectOwnerData(ownerId: string) {
  const { data: owner, error } = await supabase.from('owner_files').select('id, name, phone, email, notes, created_at').eq('id', ownerId).single()
  if (error || !owner) throw new Error(error?.message ?? 'Owner not found')
  const { data: pets, error: petsError } = await supabase.from('pets').select('id, name, species, breed, date_of_birth, pet_number, created_at, owner_since').eq('owner_file_id', ownerId)
  if (petsError) throw petsError
  const petIds = (pets ?? []).map((p) => p.id)
  const none = { data: [] }
  const [records, vaccines, appointments, invoices, contacts, waivers, balance] = await Promise.all([
    petIds.length ? supabase.from('medical_records').select('pet_id, visit_date, visit_type, presenting_complaint, diagnosis, treatment').in('pet_id', petIds).order('visit_date') : none,
    petIds.length ? supabase.from('pet_vaccines').select('pet_id, next_due_date, vaccine:vaccines(name)').in('pet_id', petIds) : none,
    petIds.length ? supabase.from('appointments').select('pet_id, scheduled_at, status, reason').in('pet_id', petIds).order('scheduled_at') : none,
    petIds.length ? supabase.from('invoices').select('pet_id, invoice_number, created_at, amount_total, payment_status').in('pet_id', petIds).order('created_at') : none,
    petIds.length ? supabase.from('pet_trusted_contacts').select('pet_id, name, phone').in('pet_id', petIds) : none,
    petIds.length ? supabase.from('pet_waivers').select('pet_id, title, signed_at, signer_name, voided_at').in('pet_id', petIds).order('signed_at') : none,
    supabase.from('owner_balance_entries').select('kind, amount, created_at').eq('owner_file_id', ownerId).order('created_at'),
  ])
  // A failed query must not print as "None" in a PDPL hand-over.
  for (const r of [records, vaccines, appointments, invoices, contacts, waivers, balance]) if ('error' in r && r.error) throw r.error
  // A pet's waivers and invoices from before it joined this owner belong to the previous owner (0092).
  const since = new Map((pets ?? []).map((p) => [p.id, p.owner_since]))
  const fromThisOwner = (petId: string | null, at: string) => petId !== null && Date.parse(at) >= Date.parse(since.get(petId) ?? '')
  return {
    exported_at: new Date().toISOString(),
    owner,
    pets: pets ?? [],
    visits: records.data ?? [],
    vaccines: vaccines.data ?? [],
    appointments: appointments.data ?? [],
    invoices: (invoices.data ?? []).filter((r) => fromThisOwner(r.pet_id, r.created_at)),
    trusted_contacts: contacts.data ?? [],
    waivers: (waivers.data ?? []).filter((r) => fromThisOwner(r.pet_id, r.signed_at)),
    balance_entries: balance.data ?? [],
  }
}

export type OwnerData = Awaited<ReturnType<typeof collectOwnerData>>

export function ownerReport(t: T, d: OwnerData): ReportDoc {
  const petName = (id: string) => d.pets.find((p) => p.id === id)?.name ?? '—'
  const section = (title: TranslationKey, head: TranslationKey[], rows: string[][], num: boolean[] = head.map(() => false)) => ({
    title: t(title),
    head: head.map((h) => t(h)),
    num,
    rows: rows.length ? rows : [[t('ownerExport.none'), ...head.slice(1).map(() => '')]],
  })
  return {
    title: t('ownerExport.title', { name: d.owner.name }),
    meta: [
      [d.owner.phone, d.owner.email].filter(Boolean).join(' · '),
      t('ownerExport.exportedAt', { when: formatDateTime(d.exported_at) }),
    ].filter(Boolean),
    sections: [
      section('ownerExport.pets', ['pets.petId', 'common.name', 'registerPet.species', 'registerPet.breed', 'registerPet.dateOfBirth'],
        d.pets.map((p) => [String(p.pet_number ?? ''), p.name, speciesLabel(t, p.species), p.breed ?? '', p.date_of_birth ? formatDate(p.date_of_birth) : ''])),
      section('ownerExport.visits', ['ownerExport.date', 'waivers.pet', 'petDetail.visitType', 'petDetail.diagnosis', 'petDetail.treatment'],
        d.visits.map((r) => [formatDate(r.visit_date), petName(r.pet_id), r.visit_type ?? '', r.diagnosis ?? '', r.treatment ?? ''])),
      section('ownerExport.vaccines', ['waivers.pet', 'vaccination.vaccine', 'ownerExport.nextDue'],
        d.vaccines.map((v) => [petName(v.pet_id), (v.vaccine as { name: string } | null)?.name ?? '', formatDate(v.next_due_date)])),
      section('ownerExport.appointments', ['ownerExport.date', 'waivers.pet', 'ownerExport.status'],
        d.appointments.map((a) => [formatDateTime(a.scheduled_at), petName(a.pet_id ?? ''), a.status])),
      section('ownerExport.invoices', ['payments.invoiceNumber', 'ownerExport.date', 'payments.total'],
        d.invoices.map((i) => [i.invoice_number, formatDate(i.created_at), formatMoney(i.amount_total)]), [false, false, true]),
      section('ownerExport.waivers', ['ownerExport.date', 'waivers.pet', 'waivers.template', 'waivers.signerName'],
        d.waivers.map((w) => [formatDate(w.signed_at), petName(w.pet_id), w.title, w.signer_name])),
      section('ownerExport.contacts', ['waivers.pet', 'common.name', 'ownerExport.phone'],
        d.trusted_contacts.map((c) => [petName(c.pet_id), c.name, c.phone ?? ''])),
    ],
    note: t('ownerExport.note'),
  }
}

export function downloadOwnerJson(d: OwnerData) {
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `owner-data-${formatIsoDate(d.exported_at)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
