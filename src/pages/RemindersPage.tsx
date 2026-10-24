import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import type { TranslationKey } from '../lib/i18n/translations'
import { clinicDay, clinicMidnight, formatDate, formatTime } from '../lib/format'
import { addDays } from '../lib/vaccination'
import { appointmentMessage, pickupMessage, vaccineMessage, whatsAppLink } from '../lib/ownerReminders'
import type { DueVaccine } from '../lib/ownerReminders'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import RefreshButton from '../components/RefreshButton'
import FormError from '../components/FormError'

type Kind = 'appointment' | 'pickup' | 'vaccine'
type PetRef = { id: string; name: string; owner_file_id: string }
type Sent = { id: string; kind: string; item_key: string; sent_at: string; sender: { full_name: string } | null }
type Owner = { id: string; name: string; phone: string | null }
type Item = { kind: Kind; key: string; owner: Owner; petId: string; title: string; detail: string; keys: string[]; text: string }

const DAY_MS = 86_400_000
// shortcut: overdue vaccines older than 30 days and pickups older than 2 days drop off the list; widen if clinics ask.
const OVERDUE_DAYS = 30
const DUE_SOON_DAYS = 7
const PICKUP_DAYS = 2

const SECTIONS: { kind: Kind; title: TranslationKey; empty: TranslationKey }[] = [
  { kind: 'appointment', title: 'ownerReminders.appointments', empty: 'ownerReminders.noAppointments' },
  { kind: 'pickup', title: 'ownerReminders.pickups', empty: 'ownerReminders.noPickups' },
  { kind: 'vaccine', title: 'ownerReminders.vaccines', empty: 'ownerReminders.noVaccines' },
]

// Owner reminders, tap-to-send (0085): reception and managers open WhatsApp with the message written
// (Arabic + English); the tap marks it sent so nobody sends it twice. Undo for a wrong tap.
function RemindersPage() {
  const { profile, clinicName, clinicPhone } = useAuth()
  const { branchName } = useBranch()
  const { t } = useLanguage()
  const toast = useToast()
  const [items, setItems] = useState<Item[] | null>(null)
  const [sent, setSent] = useState<Record<string, Sent>>({})
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    const today = clinicDay()
    const pet = 'pet:pets!inner(id, name, owner_file_id, deleted_at)'
    const [appts, stays, vaccines, sentRows, openStays] = await Promise.all([
      supabase
        .from('appointments')
        .select(`id, scheduled_at, branch_id, ${pet}`)
        .is('pet.deleted_at', null)
        .neq('status', 'cancelled')
        .gte('scheduled_at', clinicMidnight(addDays(today, 1)).toISOString())
        .lt('scheduled_at', clinicMidnight(addDays(today, 2)).toISOString())
        .order('scheduled_at'),
      supabase
        .from('inpatient_stays')
        .select(`id, branch_id, discharged_at, ${pet}`)
        .is('pet.deleted_at', null)
        .gte('discharged_at', new Date(Date.now() - PICKUP_DAYS * DAY_MS).toISOString())
        .order('discharged_at', { ascending: false }),
      supabase
        .from('pet_vaccines')
        .select(`id, next_due_date, vaccine:vaccines(name), ${pet}`)
        .is('pet.deleted_at', null)
        .gte('next_due_date', addDays(today, -OVERDUE_DAYS))
        .lte('next_due_date', addDays(today, DUE_SOON_DAYS))
        .order('next_due_date'),
      supabase
        .from('owner_reminders_sent')
        .select('id, kind, item_key, sent_at, sender:profiles!owner_reminders_sent_sent_by_fkey(full_name)')
        .gte('sent_at', new Date(Date.now() - (OVERDUE_DAYS + DUE_SOON_DAYS) * DAY_MS).toISOString()),
      supabase.from('inpatient_stays').select('pet_id').is('discharged_at', null),
    ])
    // A pet admitted again since that discharge is not ready to go home.
    const inHospital = new Set((openStays.data ?? []).map((s) => s.pet_id))
    const failed = appts.error ?? stays.error ?? vaccines.error ?? sentRows.error ?? openStays.error
    if (failed) setError(failed.message)

    const ownerIds = [...new Set([...(appts.data ?? []), ...(stays.data ?? []), ...(vaccines.data ?? [])].map((r) => (r.pet as PetRef).owner_file_id))]
    const { data: owners, error: ownerError } = ownerIds.length
      ? await supabase.from('owner_files').select('id, name, phone').in('id', ownerIds)
      : { data: [], error: null }
    if (ownerError) setError(ownerError.message)
    const ownerById = new Map((owners ?? []).map((o) => [o.id, o]))
    const ownerOf = (p: PetRef): Owner => ownerById.get(p.owner_file_id) ?? { id: p.owner_file_id, name: '—', phone: null }
    const clinic = { name: clinicName ?? t('auth.brand'), phone: clinicPhone }

    const next: Item[] = []
    for (const a of appts.data ?? []) {
      const p = a.pet as PetRef
      const owner = ownerOf(p)
      next.push({
        kind: 'appointment', key: a.id, owner, petId: p.id, title: p.name,
        detail: `${formatTime(a.scheduled_at)} · ${branchName(a.branch_id)}`,
        keys: [a.id], text: appointmentMessage(clinic, owner.name, p.name, a.scheduled_at, branchName(a.branch_id)),
      })
    }
    for (const s of stays.data ?? []) {
      const p = s.pet as PetRef
      if (inHospital.has(p.id)) continue
      const owner = ownerOf(p)
      next.push({
        kind: 'pickup', key: s.id, owner, petId: p.id, title: p.name,
        detail: branchName(s.branch_id), keys: [s.id], text: pickupMessage(clinic, owner.name, p.name, branchName(s.branch_id)),
      })
    }
    // One vaccine message per owner, listing all their pets' due vaccines. A new due date is a new reminder.
    const byOwner = new Map<string, { petId: string; rows: (DueVaccine & { key: string })[] }>()
    for (const v of vaccines.data ?? []) {
      const p = v.pet as PetRef
      const group = byOwner.get(p.owner_file_id) ?? { petId: p.id, rows: [] }
      group.rows.push({ key: `${v.id}:${v.next_due_date}`, pet: p.name, vaccine: (v.vaccine as { name: string } | null)?.name ?? '—', due: v.next_due_date })
      byOwner.set(p.owner_file_id, group)
    }
    for (const [ownerId, group] of byOwner) {
      const owner = ownerById.get(ownerId) ?? { id: ownerId, name: '—', phone: null }
      next.push({
        kind: 'vaccine', key: `vaccine:${ownerId}`, owner, petId: group.petId,
        title: [...new Set(group.rows.map((r) => r.pet))].join(', '),
        detail: group.rows.map((r) => `${r.vaccine} · ${formatDate(r.due)}`).join(' — '),
        keys: group.rows.map((r) => r.key), text: vaccineMessage(clinic, owner.name, group.rows),
      })
    }
    setItems(next)
    setSent(Object.fromEntries(((sentRows.data as Sent[] | null) ?? []).map((s) => [`${s.kind}:${s.item_key}`, s])))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once; Refresh reloads
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const sentOf = (item: Item) => item.keys.map((k) => sent[`${item.kind}:${k}`]).filter(Boolean)
  const isSent = (item: Item) => sentOf(item).length === item.keys.length

  // The link opens WhatsApp itself (no pop-up blocker); this only records the tap.
  async function markSent(item: Item) {
    const { error: sendError } = await supabase.from('owner_reminders_sent').insert(
      item.keys.filter((k) => !sent[`${item.kind}:${k}`]).map((k) => ({ clinic_id: profile!.clinic_id!, kind: item.kind, item_key: k, owner_file_id: item.owner.id })),
    )
    // Someone else marked it a moment ago: the reload shows who.
    if (sendError && sendError.code !== '23505') toast.error(sendError.message)
    load()
  }

  async function undo(item: Item) {
    const { error: undoError } = await supabase.from('owner_reminders_sent').delete().in('id', sentOf(item).map((s) => s.id))
    if (undoError) return toast.error(undoError.message)
    load()
  }

  if (items === null) return <LoadingScreen />

  const toSend = items.filter((i) => !isSent(i)).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('ownerReminders.title')}</h1>
          <p className="page-subtitle">{t('ownerReminders.toSendCount', { count: String(toSend) })}</p>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
        </div>
      </div>
      <p className="pet-owner">{t('ownerReminders.hint')}</p>

      <FormError message={error} />

      {SECTIONS.map((section) => {
        // Not sent first; sent ones stay below so a wrong tap can be undone.
        const list = items.filter((i) => i.kind === section.kind).sort((a, b) => Number(isSent(a)) - Number(isSent(b)))
        return (
          <section key={section.kind} className="reminders-section">
            <h2>{t(section.title)}</h2>
            {list.length === 0 ? (
              <p className="pet-owner">{t(section.empty)}</p>
            ) : (
              <ul className="record-list">
                {list.map((item) => {
                  const done = sentOf(item)
                  const link = whatsAppLink(item.owner.phone, item.text)
                  return (
                    <li key={item.key} className={isSent(item) ? 'reminder-sent' : undefined}>
                      <div className="record-row">
                        <div>
                          <strong>{item.owner.name}</strong>
                          {item.owner.phone && (
                            <span className="pet-owner">
                              {' · '}
                              <Ltr>{item.owner.phone}</Ltr>
                            </span>
                          )}
                          <div className="pet-owner">
                            <Link to={`/pets/${item.petId}`}>{item.title}</Link> · {item.detail}
                          </div>
                        </div>
                        <div className="record-actions">
                          {isSent(item) ? (
                            <>
                              <span className="status-badge status-completed">
                                {t('ownerReminders.sentBy', { name: done[0].sender?.full_name ?? '—', time: formatTime(done[0].sent_at) })}
                              </span>
                              <button type="button" className="secondary-button" onClick={() => undo(item)}>
                                {t('ownerReminders.undo')}
                              </button>
                            </>
                          ) : link ? (
                            <a href={link} target="_blank" rel="noreferrer" className="secondary-button" onClick={() => markSent(item)}>
                              {t('ownerReminders.send')}
                            </a>
                          ) : (
                            <span className="pet-owner">{t('ownerReminders.noPhone')}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

export default RemindersPage
