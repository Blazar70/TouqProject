import { createContext, useCallback, useContext } from 'react'
import type { ReactNode } from 'react'
import { useLanguage } from './i18n/LanguageContext'
import type { TranslationKey } from './i18n/translations'
import { useAuth } from './AuthContext'
import { visitRecordFields } from './clinicalFields'
import { signPhotoUrl } from './photoUrl'
import type { VisitRecordFields } from './clinicalFields'

export type VisitSummary = {
  date: string
  visitType?: string
  record: VisitRecordFields
  // Omitted entirely (not just falsy) when the caller's "include photo"
  // checkbox is unchecked — see PetDetail / AppointmentsPage print buttons.
  photoUrl?: string | null
}

type PrintContextValue = {
  printSummary: (petName: string, visit: VisitSummary) => void
  printHistory: (petName: string, visits: VisitSummary[]) => void
}

const PrintContext = createContext<PrintContextValue | null>(null)

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2.5rem 2.5rem 4rem;
    color: #000;
    background: #fff;
    font-size: 14px;
    line-height: 1.5;
    font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
  }
  .print-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 3px solid #b8860b;
    margin: 0 0 1.75rem;
    padding: 0 0 1rem;
  }
  .print-header h1 { margin: 0; font-size: 1.7rem; letter-spacing: -0.01em; color: #000; }
  .print-header p { margin: 0.25rem 0 0; font-size: 0.95rem; color: #000; text-transform: uppercase; letter-spacing: 0.06em; }
  .print-clinic-phone { text-transform: none !important; letter-spacing: normal !important; color: #666 !important; font-size: 0.85rem !important; }
  .print-printed-at { font-size: 0.78rem; color: #888; white-space: nowrap; }
  .print-hero { display: flex; align-items: baseline; justify-content: space-between; gap: 1.5rem; margin: 0 0 1rem; }
  .print-hero-name { font-size: 2.6rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .print-hero-date { font-size: 1.4rem; font-weight: 600; color: #444; white-space: nowrap; }
  .print-badge {
    display: inline-block; margin: 0 0 1.75rem; padding: 0.3rem 0.9rem;
    border: 1.5px solid #b8860b; border-radius: 999px; color: #8a6408;
    font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .print-fields { display: flex; flex-direction: column; gap: 1.5rem; }
  .print-field { border-inline-start: 3px solid #d8d2c4; padding-inline-start: 1rem; }
  .print-field-label { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8474; margin: 0 0 0.3rem; }
  .print-field-value { font-size: 1.05rem; line-height: 1.55; white-space: pre-wrap; }
  .print-history-entry { padding: 1.25rem 0; border-top: 1px solid #e2ddd0; break-inside: avoid; }
  .print-history-entry:first-of-type { border-top: none; padding-top: 0; }
  .print-history-entry-header { display: flex; align-items: center; gap: 0.75rem; margin: 0 0 1rem; }
  .print-history-entry-header .print-badge { margin: 0; }
  .print-history-date { font-size: 1.1rem; font-weight: 700; }
  .print-footer { margin-top: 3rem; padding-top: 0.75rem; border-top: 1px solid #ddd; font-size: 0.78rem; color: #999; text-align: center; }
  .print-photo { margin: 1rem 0 0; break-inside: avoid; }
  .print-photo img { max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 6px; }
`

function fieldsHtml(t: (key: TranslationKey) => string, visit: VisitSummary) {
  return `
    <div class="print-fields">
      ${visitRecordFields(visit.record)
        .map(
          (field) => `<div class="print-field">
               <div class="print-field-label">${escapeHtml(t(field.labelKey))}</div>
               <div class="print-field-value">${escapeHtml(field.value)}</div>
             </div>`,
        )
        .join('')}
    </div>
    ${visit.photoUrl ? `<div class="print-photo"><img src="${escapeHtml(visit.photoUrl)}" alt="" /></div>` : ''}
  `
}

function buildDocument(
  t: (key: TranslationKey) => string,
  clinicLabel: string,
  clinicPhone: string | null,
  petName: string,
  visits: VisitSummary[],
) {
  const isHistory = visits.length > 1
  const title = isHistory ? t('printSummary.historyTitle') : t('printSummary.title')

  const body = isHistory
    ? visits
        .map(
          (visit) => `
            <div class="print-history-entry">
              <div class="print-history-entry-header">
                <span class="print-history-date">${escapeHtml(new Date(visit.date).toLocaleDateString())}</span>
                ${visit.visitType ? `<span class="print-badge">${escapeHtml(visit.visitType)}</span>` : ''}
              </div>
              ${fieldsHtml(t, visit)}
            </div>
          `,
        )
        .join('')
    : `
        ${visits[0].visitType ? `<span class="print-badge">${escapeHtml(visits[0].visitType)}</span>` : ''}
        ${fieldsHtml(t, visits[0])}
      `

  const heroDate = !isHistory ? `<div class="print-hero-date">${escapeHtml(new Date(visits[0].date).toLocaleDateString())}</div>` : ''

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(petName)} — ${escapeHtml(title)}</title>
    <style>${PRINT_STYLES}</style>
  </head>
  <body>
    <header class="print-header">
      <div>
        <h1>${escapeHtml(clinicLabel)}</h1>
        ${clinicPhone ? `<p class="print-clinic-phone">${escapeHtml(clinicPhone)}</p>` : ''}
        <p>${escapeHtml(title)}</p>
      </div>
      <div class="print-printed-at">${escapeHtml(t('printSummary.printedOn'))} ${escapeHtml(new Date().toLocaleString())}</div>
    </header>
    <div class="print-hero">
      <div class="print-hero-name">${escapeHtml(petName)}</div>
      ${heroDate}
    </div>
    ${body}
    <footer class="print-footer">${escapeHtml(clinicPhone ? `${clinicLabel} · ${clinicPhone}` : clinicLabel)}</footer>
  </body>
</html>`
}

export function PrintProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage()
  const { clinicName, clinicPhone } = useAuth()

  const runPrint = useCallback(
    async (petName: string, visits: VisitSummary[]) => {
      const clinicLabel = clinicName ?? t('auth.brand')

      // A separate print window, not an in-page portal — it's a fully
      // self-contained document with its own styles, so there's no React
      // render-timing race to get wrong and no dependency on hiding the
      // rest of the app via print media queries.
      // Opened before any await: popup blockers only allow it inside the click.
      const printWindow = window.open('', '_blank', 'width=800,height=1000')
      if (!printWindow) return

      const signedVisits = await Promise.all(
        visits.map(async (visit) => (visit.photoUrl ? { ...visit, photoUrl: await signPhotoUrl(visit.photoUrl) } : visit)),
      )
      const html = buildDocument(t, clinicLabel, clinicPhone, petName, signedVisits)
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
      printWindow.onload = () => {
        printWindow.focus()
        printWindow.print()
      }
    },
    [clinicName, clinicPhone, t],
  )

  const printSummary = useCallback((petName: string, visit: VisitSummary) => runPrint(petName, [visit]), [runPrint])
  const printHistory = useCallback((petName: string, visits: VisitSummary[]) => runPrint(petName, visits), [runPrint])

  return <PrintContext.Provider value={{ printSummary, printHistory }}>{children}</PrintContext.Provider>
}

export function usePrintSummary() {
  const ctx = useContext(PrintContext)
  if (!ctx) throw new Error('usePrintSummary must be used within a PrintProvider')
  return ctx
}
