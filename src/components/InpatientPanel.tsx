import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { formatDate, formatDateTime, formatTime } from '../lib/format'
import { validateImageFile } from '../lib/imageUpload'
import { toLatinDigits } from '../lib/arabicDigits'
import { INPATIENT_MEDIA_BUCKET, MAX_VIDEO_BYTES, inpatientMessage, isVideo, stayDay, stayNights } from '../lib/inpatient'
import Ltr from './Ltr'
import FormError from './FormError'
import InpatientReminders from './InpatientReminders'

type Pet = Database['public']['Tables']['pets']['Row']
type Stay = Database['public']['Tables']['inpatient_stays']['Row'] & { admitter: { full_name: string } | null }
type Update = Database['public']['Tables']['inpatient_updates']['Row'] & { author: { full_name: string } | null }
type Draft = { note: string; weight: string; temp: string; heartRate: string }

const EMPTY_DRAFT: Draft = { note: '', weight: '', temp: '', heartRate: '' }
const SIGNED_URL_SECONDS = 60 * 60
const OUTCOMES = ['home', 'died', 'euthanised', 'transferred'] as const
type Outcome = (typeof OUTCOMES)[number]
const OUTCOME_KEYS: Record<Outcome, TranslationKey> = {
  home: 'inpatient.outcomeHome',
  died: 'inpatient.outcomeDied',
  euthanised: 'inpatient.outcomeEuthanised',
  transferred: 'inpatient.outcomeTransferred',
}
const num = (value: string) => (value.trim() ? Number(toLatinDigits(value)) : null)

// Phase 6 inpatient stay of one pet (0081): admit, timed updates with vitals and photos/videos,
// copy today's updates as text for the owner, discharge. The pet is "at" the branch of the latest update.
export type OpenStay = Pick<Stay, 'admitted_at' | 'branch_id'>

function InpatientPanel({ pet, onOpenStayChange }: { pet: Pet; onOpenStayChange?: (stay: OpenStay | null) => void }) {
  const { profile, handlesMoney } = useAuth()
  const { branchId, branchName, canWriteAt } = useBranch()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const role = profile?.clinic_role ?? ''
  const canAdmit = ['doctor', 'manager'].includes(role) && !!branchId && canWriteAt(branchId)
  const canWrite = ['doctor', 'nurse', 'manager'].includes(role) && !!branchId && canWriteAt(branchId)

  const [stays, setStays] = useState<Stay[] | null>(null)
  const [updates, setUpdates] = useState<Update[]>([])
  // Earlier stays (0086): their bill, and the updates of the one opened.
  const [billByStay, setBillByStay] = useState<Record<string, { id: string; invoice_number: string }>>({})
  const [openPastId, setOpenPastId] = useState<string | null>(null)
  const [pastUpdates, setPastUpdates] = useState<Update[] | null>(null)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [admitting, setAdmitting] = useState(false)
  // Discharge asks how the stay ended (0087): only 'home' gets an owner pickup reminder.
  const [discharging, setDischarging] = useState(false)
  // Nothing chosen at first (nightly H21): a hurried tap must not tell the owner a pet that died is ready.
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [dischargeNote, setDischargeNote] = useState('')
  const [reason, setReason] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = stays?.find((s) => !s.discharged_at) ?? null
  const past = stays?.filter((s) => s.discharged_at) ?? []

  async function load() {
    const { data, error: stayError } = await supabase
      .from('inpatient_stays')
      .select('*, admitter:profiles!inpatient_stays_admitted_by_fkey(full_name)')
      .eq('pet_id', pet.id)
      .order('admitted_at', { ascending: false })
    if (stayError) return setError(stayError.message)
    const rows = (data as Stay[] | null) ?? []
    setStays(rows)
    const closed = rows.filter((s) => s.discharged_at).map((s) => s.id)
    if (closed.length) {
      const { data: bills } = await supabase.from('invoices').select('id, invoice_number, stay_id').in('stay_id', closed)
      setBillByStay(Object.fromEntries((bills ?? []).map((b) => [b.stay_id!, b])))
    }
    const current = rows.find((s) => !s.discharged_at)
    onOpenStayChange?.(current ?? null)
    if (!current) return setUpdates([])
    const list = await loadUpdates(current.id)
    if (list) setUpdates(list)
  }

  async function loadUpdates(stayId: string) {
    const { data: ups, error: upError } = await supabase
      .from('inpatient_updates')
      .select('*, author:profiles!inpatient_updates_author_id_fkey(full_name)')
      .eq('stay_id', stayId)
      .order('created_at', { ascending: false })
    if (upError) {
      setError(upError.message)
      return null
    }
    const list = (ups as Update[] | null) ?? []
    const paths = list.flatMap((u) => u.media)
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(INPATIENT_MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
      setMediaUrls((current) => ({ ...current, ...Object.fromEntries((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl])) }))
    }
    return list
  }

  async function togglePast(stayId: string) {
    if (openPastId === stayId) return setOpenPastId(null)
    setOpenPastId(stayId)
    setPastUpdates(null)
    setPastUpdates((await loadUpdates(stayId)) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per pet
  }, [pet.id])

  async function handleAdmit(e: FormEvent) {
    e.preventDefault()
    if (!profile?.clinic_id || !branchId) return
    setBusy(true)
    setError(null)
    const { error: admitError } = await supabase
      .from('inpatient_stays')
      .insert({ clinic_id: profile.clinic_id, pet_id: pet.id, branch_id: branchId, reason: reason.trim() || null })
    setBusy(false)
    if (admitError) return setError(admitError.message)
    setAdmitting(false)
    setReason('')
    toast.success(t('inpatient.admitted', { name: pet.name }))
    load()
  }

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])]
    for (const file of picked) {
      const video = file.type.startsWith('video/')
      const problem = video ? (file.size > MAX_VIDEO_BYTES ? 'tooLarge' : null) : validateImageFile(file)
      if (problem) {
        setError(t(video ? 'inpatient.videoTooLarge' : problem === 'tooLarge' ? 'petDetail.imageTooLarge' : 'petDetail.imageOnly'))
        e.target.value = ''
        return
      }
    }
    setError(null)
    setFiles(picked)
  }

  async function handleAddUpdate(e: FormEvent) {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    if (!open || !profile?.clinic_id || !branchId) return
    setBusy(true)
    setError(null)
    const uploaded: string[] = []
    for (const file of files) {
      const path = `${profile.clinic_id}/${pet.id}/${open.id}/${crypto.randomUUID()}.${file.name.split('.').pop() || 'jpg'}`
      const { error: upError } = await supabase.storage.from(INPATIENT_MEDIA_BUCKET).upload(path, file, { contentType: file.type })
      if (upError) {
        if (uploaded.length) await supabase.storage.from(INPATIENT_MEDIA_BUCKET).remove(uploaded)
        setBusy(false)
        return setError(upError.message)
      }
      uploaded.push(path)
    }
    const { error: insertError } = await supabase.from('inpatient_updates').insert({
      clinic_id: profile.clinic_id,
      stay_id: open.id,
      branch_id: branchId,
      author_id: profile.id,
      note: draft.note.trim() || null,
      weight_kg: num(draft.weight),
      temperature_c: num(draft.temp),
      heart_rate: num(draft.heartRate),
      media: uploaded,
    })
    setBusy(false)
    if (insertError) {
      // Don't leave files nobody points at.
      if (uploaded.length) await supabase.storage.from(INPATIENT_MEDIA_BUCKET).remove(uploaded)
      return setError(insertError.message)
    }
    // reset() also clears the file picker, which React state does not control.
    form.reset()
    setDraft(EMPTY_DRAFT)
    setFiles([])
    toast.success(t('inpatient.updateSaved'))
    load()
  }

  async function handleDeleteUpdate(update: Update) {
    if (!(await confirm(t('inpatient.deleteUpdateConfirm'), { danger: true, confirmLabel: t('common.delete') }))) return
    const { data: gone, error: deleteError } = await supabase.from('inpatient_updates').delete().eq('id', update.id).select('id')
    if (deleteError || !gone?.length) return toast.error(deleteError?.message ?? t('errors.noPermission'))
    if (update.media.length) await supabase.storage.from(INPATIENT_MEDIA_BUCKET).remove(update.media)
    load()
  }

  async function handleDischarge(e: FormEvent) {
    e.preventDefault()
    if (!open || !outcome) return
    setBusy(true)
    const { error: dischargeError } = await supabase
      .from('inpatient_stays')
      .update({ discharged_at: new Date().toISOString(), discharge_outcome: outcome, discharge_note: dischargeNote.trim() || null })
      .eq('id', open.id)
    setBusy(false)
    if (dischargeError) return setError(dischargeError.message)
    setDischarging(false)
    setOutcome(null)
    setDischargeNote('')
    toast.success(t('inpatient.discharged', { name: pet.name }))
    load()
  }

  async function handleCopy() {
    const text = inpatientMessage(t, pet.name, [...updates].reverse())
    if (!text) return toast.error(t('inpatient.nothingToday'))
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('inpatient.copied'))
    } catch {
      toast.error(t('inpatient.copyFailed'))
    }
  }

  // One stay's updates; earlier stays are read-only.
  const updateList = (list: Update[], readOnly: boolean) => (
    <ul className="record-list">
      {list.map((u) => (
        <li key={u.id}>
          <div className="record-row">
            <div>
              <strong>
                <Ltr>{formatDate(u.created_at)} {formatTime(u.created_at)}</Ltr>
              </strong>{' '}
              <span className="pet-owner">
                · {u.author?.full_name ?? '—'} · {branchName(u.branch_id)}
              </span>
              {u.note && (
                <div className="inpatient-note" dir="auto">
                  {u.note}
                </div>
              )}
              {(u.temperature_c != null || u.heart_rate != null || u.weight_kg != null) && (
                <div className="pet-owner">
                  {[
                    u.temperature_c != null && t('inpatient.tempShort', { value: String(u.temperature_c) }),
                    u.heart_rate != null && t('inpatient.hrShort', { value: String(u.heart_rate) }),
                    u.weight_kg != null && t('inpatient.weightShort', { value: String(u.weight_kg) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
              {u.media.length > 0 && (
                <div className="inpatient-media">
                  {u.media.map((path) =>
                    !mediaUrls[path] ? null : isVideo(path) ? (
                      <video key={path} src={mediaUrls[path]} controls preload="metadata" />
                    ) : (
                      <a key={path} href={mediaUrls[path]} target="_blank" rel="noreferrer">
                        <img src={mediaUrls[path]} alt={t('inpatient.photoAlt', { name: pet.name })} />
                      </a>
                    ),
                  )}
                </div>
              )}
            </div>
            {!readOnly && (u.author_id === profile?.id || role === 'manager') && (
              <div className="record-actions">
                <button type="button" className="delete-button" onClick={() => handleDeleteUpdate(u)}>
                  {t('common.delete')}
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )

  if (stays === null) return null

  return (
    <div id="pet-inpatient" className={`vaccination-panel inpatient-panel${open ? ' is-admitted' : ''}`}>
      <div className="panel-header">
        <h3>{t('inpatient.title')}</h3>
        {open ? (
          <div className="record-actions">
            <button type="button" className="secondary-button" onClick={handleCopy}>
              {t('inpatient.copyToday')}
            </button>
            {canAdmit && (
              <button type="button" className="secondary-button" onClick={() => setDischarging(true)} disabled={discharging}>
                {t('inpatient.discharge')}
              </button>
            )}
          </div>
        ) : (
          canAdmit &&
          !admitting && (
            <button type="button" className="secondary-button" onClick={() => setAdmitting(true)}>
              {t('inpatient.admit')}
            </button>
          )
        )}
      </div>

      <FormError message={error} />

      {open ? (
        <p className="pet-owner">
          <strong>{t('inpatient.day', { count: String(stayDay(open.admitted_at)) })}</strong> · {t('inpatient.atBranch', { branch: branchName(open.branch_id) })} ·{' '}
          {t('inpatient.admittedBy', { when: formatDateTime(open.admitted_at), name: open.admitter?.full_name ?? '—' })}
          {open.reason && ` · ${open.reason}`}
        </p>
      ) : (
        !admitting && <p className="pet-owner">{t('inpatient.notAdmitted')}</p>
      )}

      {discharging && open && (
        <form onSubmit={handleDischarge} className="pet-form">
          <fieldset className="checkbox-group">
            <legend>{t('inpatient.outcome', { name: pet.name })}</legend>
            {OUTCOMES.map((o) => (
              <label key={o} className="checkbox-label">
                <input type="radio" name="discharge-outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} required />
                {t(OUTCOME_KEYS[o])}
              </label>
            ))}
          </fieldset>
          <label>
            {t('inpatient.dischargeNote')}
            <input value={dischargeNote} onChange={(e) => setDischargeNote(e.target.value)} />
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={busy || !outcome}>
              {busy ? t('common.saving') : t('inpatient.discharge')}
            </button>
            <button type="button" className="cancel-button" onClick={() => {
                setDischarging(false)
                setOutcome(null)
              }}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {admitting && (
        <form onSubmit={handleAdmit} className="pet-form">
          <label>
            {t('inpatient.reason')}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('inpatient.reasonHint')} />
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('inpatient.admitAt', { branch: branchName(branchId) })}
            </button>
            <button type="button" className="cancel-button" onClick={() => setAdmitting(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {open && <InpatientReminders stayId={open.id} />}

      {open && canWrite && (
        <form onSubmit={handleAddUpdate} className="pet-form">
          <label>
            {t('inpatient.note')}
            <textarea rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <div className="pet-form-grid">
            <label>
              {t('inpatient.temperature')}
              <input type="text" inputMode="decimal" dir="ltr" value={draft.temp} onChange={(e) => setDraft({ ...draft, temp: e.target.value })} />
            </label>
            <label>
              {t('inpatient.heartRate')}
              <input type="text" inputMode="numeric" dir="ltr" value={draft.heartRate} onChange={(e) => setDraft({ ...draft, heartRate: e.target.value })} />
            </label>
            <label>
              {t('inpatient.weight')}
              <input type="text" inputMode="decimal" dir="ltr" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: e.target.value })} />
            </label>
          </div>
          <label>
            {t('inpatient.media')}
            <input type="file" accept="image/*,video/*" multiple onChange={handleFiles} />
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={busy || (!draft.note.trim() && !draft.temp && !draft.heartRate && !draft.weight && files.length === 0)}>
              {busy ? t('common.saving') : t('inpatient.addUpdate', { branch: branchName(branchId) })}
            </button>
          </div>
        </form>
      )}

      {open && updates.length === 0 && <p className="pet-owner">{t('inpatient.noUpdates')}</p>}
      {open && updates.length > 0 && updateList(updates, false)}

      {past.length > 0 && (
        <>
          <h4 className="vaccination-history-title">{t('inpatient.pastStays')}</h4>
          <ul className="record-list">
            {past.map((s) => {
              const bill = billByStay[s.id]
              return (
                <li key={s.id}>
                  <div className="record-row">
                    <div>
                      <Ltr>
                        {formatDate(s.admitted_at)} – {formatDate(s.discharged_at!)}
                      </Ltr>
                      <span className="pet-owner">
                        {' · '}
                        {t('inpatient.nights', { count: String(stayNights(s.admitted_at, s.discharged_at!)) })}
                        {s.discharge_outcome && ` · ${t(OUTCOME_KEYS[s.discharge_outcome as Outcome])}`}
                        {s.reason && ` · ${s.reason}`}
                      </span>
                    </div>
                    <div className="record-actions">
                      <button type="button" className="secondary-button" aria-expanded={openPastId === s.id} onClick={() => togglePast(s.id)}>
                        {t(openPastId === s.id ? 'inpatient.hideUpdates' : 'inpatient.showUpdates')}
                      </button>
                      {bill ? (
                        <Link to={`/payments?invoice=${bill.id}`} className="status-badge status-completed">
                          {t('inpatient.billed', { number: bill.invoice_number })}
                        </Link>
                      ) : (
                        handlesMoney && (
                          <Link to={`/payments?stay=${s.id}`} className="secondary-button">
                            {t('inpatient.billStay')}
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                  {openPastId === s.id &&
                    (pastUpdates === null ? (
                      <p className="pet-owner">{t('common.loading')}</p>
                    ) : pastUpdates.length === 0 ? (
                      <p className="pet-owner">{t('inpatient.noUpdates')}</p>
                    ) : (
                      updateList(pastUpdates, true)
                    ))}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export default InpatientPanel
