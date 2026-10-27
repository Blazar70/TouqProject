import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { translations } from '../lib/i18n/translations'
import type { TranslationKey } from '../lib/i18n/translations'
import { useToast } from '../lib/ToastContext'
import { usePrintSummary } from '../lib/PrintContext'
import type { Database } from '../lib/database.types'
import { clinicMidnight, formatDateTime, formatTime } from '../lib/format'
import Ltr from './Ltr'
import FormError from './FormError'
import Modal from './Modal'
import RequiredMark from './RequiredMark'
import SignaturePad from './SignaturePad'

type Pet = Database['public']['Tables']['pets']['Row']
type Template = Database['public']['Tables']['waiver_templates']['Row']
type Waiver = Database['public']['Tables']['pet_waivers']['Row'] & {
  collector: { full_name: string } | null
  voider: { full_name: string } | null
}
type Link = { value: string; label: string; appointmentId?: string; stayId?: string }
type Lang = 'en' | 'ar'

const DAY_MS = 24 * 60 * 60 * 1000

// Signed waivers of one pet (0084). The owner signs on the clinic tablet; the signed copy never
// changes, a manager may void it with a reason. Offers the hospital-stay waiver during an open stay.
function WaiversPanel({ pet }: { pet: Pet }) {
  const { profile } = useAuth()
  const { branchId, branchName, canWriteAt } = useBranch()
  const { t, language } = useLanguage()
  const toast = useToast()
  const { printWaiver } = usePrintSummary()
  const canSign = !!profile?.clinic_role && !!branchId && canWriteAt(branchId)
  const isManager = profile?.clinic_role === 'manager'

  const [waivers, setWaivers] = useState<Waiver[] | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [links, setLinks] = useState<Link[]>([])
  const [openStayId, setOpenStayId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState<{ templateId: string; link: string } | null>(null)
  const [viewing, setViewing] = useState<Waiver | null>(null)

  async function load() {
    const [w, tpl, stay, appts] = await Promise.all([
      supabase
        .from('pet_waivers')
        .select('*, collector:profiles!pet_waivers_collected_by_fkey(full_name), voider:profiles!pet_waivers_voided_by_fkey(full_name)')
        .eq('pet_id', pet.id)
        .order('signed_at', { ascending: false }),
      supabase.from('waiver_templates').select('*').eq('active', true).order('created_at'),
      supabase.from('inpatient_stays').select('id').eq('pet_id', pet.id).is('discharged_at', null).maybeSingle(),
      supabase
        .from('appointments')
        .select('id, scheduled_at')
        .eq('pet_id', pet.id)
        .neq('status', 'cancelled')
        .gte('scheduled_at', clinicMidnight().toISOString())
        .lt('scheduled_at', new Date(clinicMidnight().getTime() + DAY_MS).toISOString())
        .order('scheduled_at'),
    ])
    const failed = w.error ?? tpl.error ?? stay.error ?? appts.error
    if (failed) setError(failed.message)
    setWaivers((w.data as Waiver[] | null) ?? [])
    setTemplates(tpl.data ?? [])
    setOpenStayId(stay.data?.id ?? null)
    setLinks([
      ...(stay.data ? [{ value: `stay:${stay.data.id}`, label: t('waivers.linkStay'), stayId: stay.data.id }] : []),
      ...(appts.data ?? []).map((a) => ({ value: `appt:${a.id}`, label: t('waivers.linkVisit', { time: formatTime(a.scheduled_at) }), appointmentId: a.id })),
    ])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per pet
  }, [pet.id])

  if (waivers === null) return null

  const suggested = openStayId && !waivers.some((w) => w.stay_id === openStayId && !w.voided_at) ? templates.find((tpl) => tpl.suggest_on_admit) : undefined
  const title = (tpl: Template) => (language === 'ar' ? tpl.title_ar : tpl.title_en)

  return (
    <div className="vaccination-panel inpatient-panel">
      <div className="panel-header">
        <h3>{t('waivers.title')}</h3>
        {canSign && templates.length > 0 && (
          <button type="button" className="secondary-button" onClick={() => setSigning({ templateId: templates[0].id, link: '' })}>
            {t('waivers.collect')}
          </button>
        )}
      </div>

      <FormError message={error} />

      {suggested && canSign && (
        <div className="waiver-suggest">
          <span>{t('waivers.staySuggest')}</span>
          <button type="button" className="primary-button" onClick={() => setSigning({ templateId: suggested.id, link: `stay:${openStayId}` })}>
            {t('waivers.collectNamed', { name: title(suggested) })}
          </button>
        </div>
      )}

      {waivers.length === 0 ? (
        <p className="pet-owner">{templates.length === 0 ? t(isManager ? 'waivers.noTemplatesManager' : 'waivers.noTemplatesStaff') : t('waivers.none')}</p>
      ) : (
        <ul className="record-list">
          {waivers.map((w) => (
            <li key={w.id}>
              <div className="record-row">
                <div>
                  <strong dir="auto">{w.title}</strong> {w.voided_at && <span className="status-badge status-cancelled">{t('waivers.voided')}</span>}
                  <div className="pet-owner">
                    <Ltr>{formatDateTime(w.signed_at)}</Ltr> · {w.signer_name}
                  </div>
                </div>
                <div className="record-actions">
                  <button type="button" className="secondary-button" onClick={() => setViewing(w)}>
                    {t('waivers.view')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {signing && (
        <SignWaiverModal
          pet={pet}
          templates={templates}
          links={links}
          initial={signing}
          onClose={() => setSigning(null)}
          onSigned={() => {
            setSigning(null)
            toast.success(t('waivers.signed'))
            load()
          }}
        />
      )}

      {viewing && (
        <ViewWaiverModal
          waiver={viewing}
          canVoid={isManager && !viewing.voided_at}
          onClose={() => setViewing(null)}
          onPrint={() =>
            printWaiver({
              language: viewing.language as Lang,
              title: viewing.title,
              body: viewing.body,
              petName: pet.name,
              petNumber: pet.pet_number,
              signerName: viewing.signer_name,
              signedAt: viewing.signed_at,
              collectedBy: viewing.collector?.full_name ?? '—',
              branch: branchName(viewing.branch_id),
              signature: viewing.signature,
              voided: viewing.voided_at ? { at: viewing.voided_at, by: viewing.voider?.full_name ?? '—', reason: viewing.void_reason ?? '' } : undefined,
            })
          }
          onVoided={() => {
            setViewing(null)
            toast.success(t('waivers.voidedToast'))
            load()
          }}
        />
      )}
    </div>
  )
}

function SignWaiverModal({
  pet,
  templates,
  links,
  initial,
  onClose,
  onSigned,
}: {
  pet: Pet
  templates: Template[]
  links: Link[]
  initial: { templateId: string; link: string }
  onClose: () => void
  onSigned: () => void
}) {
  const { profile } = useAuth()
  const { branchId, branchName } = useBranch()
  const { t, language } = useLanguage()
  const [templateId, setTemplateId] = useState(initial.templateId)
  const [lang, setLang] = useState<Lang>(language)
  const [link, setLink] = useState(initial.link)
  const [signerName, setSignerName] = useState(pet.owner_name ?? '')
  const [agreed, setAgreed] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Nightly H18: the owner reads and signs full screen, in their language, with no staff controls.
  const [ownerView, setOwnerView] = useState(false)
  const tl = (key: TranslationKey) => (ownerView ? (translations[lang] as Record<string, string>)[key] ?? t(key) : t(key))

  const template = templates.find((tpl) => tpl.id === templateId)!
  const chosen = links.find((l) => l.value === link)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile?.clinic_id || !branchId) return
    if (!signature) return setError(t('waivers.signatureRequired'))
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('pet_waivers').insert({
      clinic_id: profile.clinic_id,
      pet_id: pet.id,
      branch_id: branchId,
      template_id: templateId,
      language: lang,
      signer_name: signerName.trim(),
      signature,
      appointment_id: chosen?.appointmentId ?? null,
      stay_id: chosen?.stayId ?? null,
    })
    setBusy(false)
    if (insertError) return setError(insertError.message)
    onSigned()
  }

  return (
    <Modal onClose={onClose} labelledBy="sign-waiver-title" className={ownerView ? 'booking-modal waiver-owner-view' : 'booking-modal'}>
      {ownerView ? (
        <div className="waiver-owner-bar" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
          <h2 id="sign-waiver-title">{lang === 'ar' ? template.title_ar : template.title_en}</h2>
          <div className="waiver-lang-switch" role="group" aria-label={tl('waivers.language')}>
            {(['en', 'ar'] as const).map((l) => (
              <button key={l} type="button" className="secondary-button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l === 'en' ? 'English' : 'العربية'}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <h2 id="sign-waiver-title">{t('waivers.collectFor', { name: pet.name })}</h2>
      )}
      <form onSubmit={handleSubmit} className="pet-form" dir={ownerView ? (lang === 'ar' ? 'rtl' : 'ltr') : undefined} lang={ownerView ? lang : undefined}>
        {!ownerView && (
        <div className="pet-form-grid">
          <label>
            {t('waivers.template')}
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {language === 'ar' ? tpl.title_ar : tpl.title_en}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('waivers.language')}
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
          {links.length > 0 && (
            <label>
              {t('waivers.linkTo')}
              <select value={link} onChange={(e) => setLink(e.target.value)}>
                <option value="">{t('waivers.linkNone')}</option>
                {links.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        )}

        <section className="waiver-text" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
          {!ownerView && <h3>{lang === 'ar' ? template.title_ar : template.title_en}</h3>}
          <p>{lang === 'ar' ? template.body_ar : template.body_en}</p>
        </section>

        {!ownerView && (
          <div className="waiver-hand-over">
            <p className="pet-owner">{t('waivers.handOver', { branch: branchName(branchId) })}</p>
            <button type="button" className="secondary-button" onClick={() => setOwnerView(true)}>
              {t('waivers.showToOwner')}
            </button>
          </div>
        )}
        <FormError message={error} />
        <label>
          {tl('waivers.signerName')}
          <RequiredMark />
          <input value={signerName} onChange={(e) => setSignerName(e.target.value)} required />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
          {tl('waivers.agree')}
        </label>
        <SignaturePad onChange={setSignature} label={tl('waivers.signHere')} clearLabel={tl('waivers.clearSignature')} />
        <div className="record-edit-actions">
          <button type="submit" disabled={busy || !signature || !agreed || !signerName.trim()}>
            {busy ? tl('common.saving') : tl('waivers.sign')}
          </button>
          {ownerView ? (
            <button type="button" className="cancel-button" onClick={() => setOwnerView(false)}>
              {t('waivers.backToStaff')}
            </button>
          ) : (
            <button type="button" className="cancel-button" onClick={onClose}>
              {t('common.cancel')}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

function ViewWaiverModal({
  waiver,
  canVoid,
  onClose,
  onPrint,
  onVoided,
}: {
  waiver: Waiver
  canVoid: boolean
  onClose: () => void
  onPrint: () => void
  onVoided: () => void
}) {
  const { branchName } = useBranch()
  const { t } = useLanguage()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVoid(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: voidError } = await supabase.from('pet_waivers').update({ voided_at: new Date().toISOString(), void_reason: reason.trim() }).eq('id', waiver.id)
    setBusy(false)
    if (voidError) return setError(voidError.message)
    onVoided()
  }

  return (
    <Modal onClose={onClose} labelledBy="view-waiver-title" className="booking-modal">
      <h2 id="view-waiver-title" dir="auto">
        {waiver.title}
      </h2>
      {waiver.voided_at && (
        <p className="waiver-voided" role="note">
          {t('waivers.voidedBy', { name: waiver.voider?.full_name ?? '—' })} · <Ltr>{formatDateTime(waiver.voided_at)}</Ltr>
          <br />
          {waiver.void_reason}
        </p>
      )}
      <p className="pet-owner">
        {t('waivers.signedBy', { name: waiver.signer_name })} · <Ltr>{formatDateTime(waiver.signed_at)}</Ltr> · {t('waivers.collectedByName', { name: waiver.collector?.full_name ?? '—' })} ·{' '}
        {branchName(waiver.branch_id)}
      </p>
      <section className="waiver-text" dir={waiver.language === 'ar' ? 'rtl' : 'ltr'} lang={waiver.language}>
        <p>{waiver.body}</p>
      </section>
      <img className="waiver-signature" src={waiver.signature} alt={t('waivers.signatureOf', { name: waiver.signer_name })} />
      <div className="record-edit-actions">
        <button type="button" onClick={onPrint}>
          {t('waivers.print')}
        </button>
        <button type="button" className="cancel-button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
      {canVoid && (
        <form onSubmit={handleVoid} className="pet-form">
          <FormError message={error} />
          <label>
            {t('waivers.voidReason')}
            <RequiredMark />
            <input value={reason} onChange={(e) => setReason(e.target.value)} required />
          </label>
          <div className="record-edit-actions">
            <button type="submit" className="delete-button" disabled={busy || !reason.trim()}>
              {busy ? t('common.saving') : t('waivers.void')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export default WaiversPanel
