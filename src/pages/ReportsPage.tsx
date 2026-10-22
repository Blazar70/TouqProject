import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import { useAuth } from '../lib/AuthContext'
import { useBranch, useBranchView } from '../lib/BranchContext'
import { ALL_BRANCHES } from '../lib/branchChoice'
import { usePrintSummary } from '../lib/PrintContext'
import { downloadCsv } from '../lib/csvExport'
import { clinicDay, formatDate, formatMoney } from '../lib/format'
import type { Database } from '../lib/database.types'
import BranchFilter from '../components/BranchFilter'
import Ltr from '../components/Ltr'

type Fn = Database['public']['Functions']
type ReportKey = 'cashUp' | 'unpaid' | 'income' | 'vat'
type Data =
  | { key: 'cashUp'; rows: Fn['report_cash_up']['Returns'] }
  | { key: 'unpaid'; rows: Fn['report_unpaid']['Returns'] }
  | { key: 'income'; services: Fn['report_income_services']['Returns']; branches: Fn['report_income_branches']['Returns'] }
  | { key: 'vat'; rows: Fn['report_vat_summary']['Returns'] }

// money: right-aligned amount · count: right-aligned integer · ltr: left-to-right text (numbers, phones)
type Kind = 'text' | 'ltr' | 'money' | 'count'
type Cell = string | number | null
type Section = { title?: string; cls: string; head: string[]; kinds: Kind[]; rows: Cell[][]; foot?: Cell[] }

const REPORTS: { key: ReportKey; label: TranslationKey }[] = [
  { key: 'cashUp', label: 'reports.cashUp' },
  { key: 'unpaid', label: 'reports.unpaid' },
  { key: 'income', label: 'reports.income' },
  { key: 'vat', label: 'reports.vat' },
]
const DRAWER_METHODS = ['cash', 'card', 'apple_pay'] as const
const METHOD_LABEL: Record<string, TranslationKey> = {
  cash: 'payments.methodCash',
  card: 'payments.methodCard',
  apple_pay: 'payments.methodApplePay',
  balance: 'payments.methodBalance',
}

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100

// Money reports for the clinic. Every figure comes from a 0065 SQL function, by clinic-time days.
function ReportsPage() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const { branchName } = useBranch()
  const { printReport } = usePrintSummary()
  const isManager = profile?.clinic_role === 'manager'
  const [viewBranch, setViewBranch] = useBranchView(isManager)
  const branch = viewBranch === ALL_BRANCHES ? null : viewBranch
  const today = clinicDay()
  const [report, setReport] = useState<ReportKey>('cashUp')
  const [day, setDay] = useState(today)
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [unpaidFrom, setUnpaidFrom] = useState('')
  const [unpaidTo, setUnpaidTo] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    async function load(): Promise<Data> {
      const range = { p_from: from, p_to: to, p_branch: branch }
      if (report === 'cashUp') {
        const { data: rows, error: e } = await supabase.rpc('report_cash_up', { p_day: day, p_branch: branch })
        if (e) throw e
        return { key: report, rows: rows ?? [] }
      }
      if (report === 'unpaid') {
        const { data: rows, error: e } = await supabase.rpc('report_unpaid', { p_branch: branch, p_from: unpaidFrom || null, p_to: unpaidTo || null })
        if (e) throw e
        return { key: report, rows: rows ?? [] }
      }
      if (report === 'income') {
        const [s, b] = await Promise.all([supabase.rpc('report_income_services', range), supabase.rpc('report_income_branches', range)])
        if (s.error) throw s.error
        if (b.error) throw b.error
        return { key: report, services: s.data ?? [], branches: b.data ?? [] }
      }
      const { data: rows, error: e } = await supabase.rpc('report_vat_summary', range)
      if (e) throw e
      return { key: report, rows: rows ?? [] }
    }
    setData(null)
    setError(null)
    load().then(
      (result) => !stale && setData(result),
      () => !stale && setError(t('reports.loadError')),
    )
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, branch, day, from, to, unpaidFrom, unpaidTo])

  const branchLabel = branch ? branchName(branch) : t('staff.allBranches')
  const rangeLabel = report === 'cashUp' ? formatDate(day) : `${formatDate(from)} – ${formatDate(to)}`

  function build(d: Data): { sections: Section[]; tiles?: { label: string; value: number }[]; note: string } {
    if (d.key === 'cashUp') {
      const drawer = d.rows.filter((r) => r.method !== 'balance')
      const branchIds = [...new Set(d.rows.map((r) => r.branch_id))].sort((a, b) => branchName(a).localeCompare(branchName(b)))
      const rows: Cell[][] = branchIds.flatMap((id) =>
        DRAWER_METHODS.map((m) => {
          const r = drawer.find((x) => x.branch_id === id && x.method === m)
          return [branchName(id), t(METHOD_LABEL[m]), r?.payments ?? 0, r?.deposits ?? 0, r?.refunds ?? 0, r?.net ?? 0, r?.entries ?? 0]
        }),
      )
      const balance = d.rows.filter((r) => r.method === 'balance')
      return {
        tiles: [
          ...DRAWER_METHODS.map((m) => ({ label: t(METHOD_LABEL[m]), value: sum(drawer.filter((r) => r.method === m).map((r) => r.net)) })),
          { label: t('reports.paidFromBalance'), value: sum(balance.map((r) => r.payments)) },
          { label: t('reports.refundedToBalance'), value: sum(balance.map((r) => r.refunds)) },
        ],
        sections: [
          {
            cls: 'data-r-cash',
            head: [t('print.branch'), t('payments.method'), t('reports.payments'), t('reports.deposits'), t('reports.refunds'), t('reports.net'), t('reports.count')],
            kinds: ['text', 'text', 'money', 'money', 'money', 'money', 'count'],
            rows,
            foot: rows.length
              ? [t('reports.total'), '', ...[2, 3, 4, 5].map((i) => sum(rows.map((r) => r[i] as number))), rows.reduce((a, r) => a + (r[6] as number), 0)]
              : undefined,
          },
        ],
        note: t('reports.cashUpNote'),
      }
    }
    if (d.key === 'unpaid') {
      const visits = d.rows.filter((r) => r.kind === 'visit')
      const bills = d.rows.filter((r) => r.kind === 'invoice')
      return {
        sections: [
          {
            title: t('reports.unbilledVisits'),
            cls: 'data-r-visits',
            head: [t('payments.date'), t('list.pet'), t('pets.petId'), t('list.owner'), t('common.phone'), t('reports.doctor'), t('print.branch'), t('reports.servicesTotal')],
            kinds: ['text', 'text', 'ltr', 'text', 'ltr', 'text', 'text', 'money'],
            rows: visits.map((r) => [formatDate(clinicDay(r.at)), r.pet_name, r.pet_number, r.owner_name, r.owner_phone, r.doctor_name, branchName(r.branch_id), r.total]),
            foot: visits.length ? [t('reports.total'), '', '', '', '', '', '', sum(visits.map((r) => r.total))] : undefined,
          },
          {
            title: t('reports.unpaidInvoices'),
            cls: 'data-r-bills',
            head: [t('payments.date'), t('payments.invoiceNumber'), t('list.pet'), t('pets.petId'), t('list.owner'), t('common.phone'), t('payments.total'), t('payments.paid'), t('payments.remaining')],
            kinds: ['text', 'ltr', 'text', 'ltr', 'text', 'ltr', 'money', 'money', 'money'],
            rows: bills.map((r) => [formatDate(clinicDay(r.at)), r.invoice_number, r.pet_name, r.pet_number, r.owner_name, r.owner_phone, r.total, r.paid, r.remaining]),
            foot: bills.length
              ? [t('reports.total'), '', '', '', '', '', sum(bills.map((r) => r.total)), sum(bills.map((r) => r.paid)), sum(bills.map((r) => r.remaining))]
              : undefined,
          },
        ],
        note: t('reports.unpaidNote'),
      }
    }
    if (d.key === 'income') {
      const s = d.services
      const b = [...d.branches].sort((x, y) => branchName(x.branch_id).localeCompare(branchName(y.branch_id)))
      return {
        sections: [
          {
            title: t('reports.perService'),
            cls: 'data-r-services',
            head: [t('reports.service'), t('payments.quantity'), t('reports.netExVat'), t('payments.vat'), t('reports.totalInclVat'), t('payments.creditedAmount')],
            kinds: ['text', 'count', 'money', 'money', 'money', 'money'],
            rows: s.map((r) => [r.service_id ? (r.service_name ?? '—') : t('reports.other'), r.quantity, r.net, r.vat, r.total, r.credited]),
            foot: s.length
              ? [t('reports.total'), s.reduce((a, r) => a + r.quantity, 0), sum(s.map((r) => r.net)), sum(s.map((r) => r.vat)), sum(s.map((r) => r.total)), sum(s.map((r) => r.credited))]
              : undefined,
          },
          {
            title: t('reports.perBranch'),
            cls: 'data-r-branches',
            head: [t('print.branch'), t('reports.invoiced'), t('payments.creditedAmount'), t('reports.net'), t('reports.collected')],
            kinds: ['text', 'money', 'money', 'money', 'money'],
            rows: b.map((r) => [branchName(r.branch_id), r.invoiced, r.credited, r.net, r.collected]),
            foot: b.length
              ? [t('reports.total'), sum(b.map((r) => r.invoiced)), sum(b.map((r) => r.credited)), sum(b.map((r) => r.net)), sum(b.map((r) => r.collected))]
              : undefined,
          },
        ],
        note: t('reports.incomeNote'),
      }
    }
    const rate = (r: { vat_rate: number }) => ({ rate: String(r.vat_rate) })
    const rows: Cell[][] = [
      ...d.rows.map((r) => [r.vat_rate > 0 ? t('reports.standardSales', rate(r)) : t('reports.zeroSales'), r.sales_net, r.sales_vat]),
      ...d.rows
        .filter((r) => r.credit_net !== 0 || r.credit_vat !== 0)
        .map((r) => [r.vat_rate > 0 ? t('reports.creditNotesRate', rate(r)) : t('reports.creditNotesZero'), r.credit_net, r.credit_vat]),
    ]
    return {
      tiles: [
        { label: t('reports.netTaxable'), value: sum(d.rows.map((r) => r.net_taxable)) },
        { label: t('reports.netVatDue'), value: sum(d.rows.map((r) => r.net_vat)) },
        { label: t('reports.discounts'), value: sum(d.rows.map((r) => r.discounts)) },
      ],
      sections: [
        {
          cls: 'data-r-vat',
          head: [t('reports.line'), t('reports.netExVat'), t('payments.vat')],
          kinds: ['text', 'money', 'money'],
          rows,
          foot: rows.length ? [t('reports.netTotals'), sum(d.rows.map((r) => r.net_taxable)), sum(d.rows.map((r) => r.net_vat))] : undefined,
        },
      ],
      note: t('reports.vatNote'),
    }
  }

  const built = data && data.key === report ? build(data) : null
  const title = t(REPORTS.find((r) => r.key === report)!.label)
  const meta = [`${t('print.branch')}: ${branchLabel}`, report === 'unpaid' ? (unpaidFrom || unpaidTo ? `${unpaidFrom || '…'} – ${unpaidTo || '…'}` : '') : rangeLabel].filter(Boolean)
  const show = (v: Cell, k: Kind) => (v === null || v === '' ? '' : k === 'money' ? formatMoney(v as number) : String(v))

  function exportCsv() {
    if (!built) return
    const rows: unknown[][] = [meta]
    for (const s of built.sections) {
      const csv = (v: Cell, k: Kind) => (k === 'money' && typeof v === 'number' ? v.toFixed(2) : v)
      rows.push([], ...(s.title ? [[s.title]] : []), s.head, ...s.rows.map((r) => r.map((v, i) => csv(v, s.kinds[i]))))
      if (s.foot) rows.push(s.foot.map((v, i) => csv(v, s.kinds[i])))
    }
    for (const tile of built.tiles ?? []) rows.push([tile.label, tile.value.toFixed(2)])
    downloadCsv(`${report}-${report === 'cashUp' ? day : report === 'unpaid' ? today : `${from}_${to}`}.csv`, [title], rows)
  }

  function print() {
    if (!built) return
    printReport({
      title,
      meta: [...meta, ...(built.tiles ?? []).map((tile) => `${tile.label}: ${formatMoney(tile.value)} ${t('common.currency')}`)],
      sections: built.sections.map((s) => ({
        title: s.title,
        head: s.head,
        num: s.kinds.map((k) => k === 'money' || k === 'count'),
        rows: s.rows.map((r) => r.map((v, i) => show(v, s.kinds[i]))),
        foot: s.foot?.map((v, i) => show(v, s.kinds[i])),
      })),
      note: built.note,
    })
  }

  const dateInput = (label: TranslationKey, value: string, set: (v: string) => void, required = true) => (
    <label>
      {t(label)}
      <input type="date" dir="ltr" value={value} required={required} onChange={(e) => (e.target.value || !required) && set(e.target.value)} />
    </label>
  )

  return (
    <div>
      <div className="page-header">
        <h1>{t('reports.title')}</h1>
        <div className="page-header-actions">
          <BranchFilter value={viewBranch} onChange={setViewBranch} />
        </div>
      </div>

      <div className="report-tabs" role="tablist" aria-label={t('reports.title')}>
        {REPORTS.map((r) => (
          <button key={r.key} type="button" role="tab" aria-selected={report === r.key} className="report-tab" onClick={() => setReport(r.key)}>
            {t(r.label)}
          </button>
        ))}
      </div>

      <section className="dash-panel" aria-label={title}>
        <div className="dash-panel-header">
          <h2>{title}</h2>
          <div className="page-header-actions">
            <button type="button" className="secondary-button" disabled={!built} onClick={exportCsv}>
              {t('admin.exportCsv')}
            </button>
            <button type="button" className="secondary-button" disabled={!built} onClick={print}>
              {t('payments.print')}
            </button>
          </div>
        </div>
        <div className="dash-panel-body">
          <div className="payments-filters report-filters">
            {report === 'cashUp' && dateInput('reports.day', day, setDay)}
            {(report === 'income' || report === 'vat') && (
              <>
                {dateInput('payments.filterFrom', from, setFrom)}
                {dateInput('payments.filterTo', to, setTo)}
              </>
            )}
            {report === 'unpaid' && (
              <>
                {dateInput('payments.filterFrom', unpaidFrom, setUnpaidFrom, false)}
                {dateInput('payments.filterTo', unpaidTo, setUnpaidTo, false)}
              </>
            )}
          </div>
          {built && <p className="report-note">{built.note}</p>}
          {error && <p className="form-error">{error}</p>}
          {!built && !error && <p className="data-muted">{t('common.loading')}</p>}

          {built?.tiles && (
            <div className={`dash-stats report-tiles${built.tiles.length === 5 ? ' dash-stats-5' : ''}`}>
              {built.tiles.map((tile) => (
                <div key={tile.label} className="stat-tile">
                  <div className="stat-number">
                    <Ltr>{formatMoney(tile.value)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
                  </div>
                  <div className="stat-label">{tile.label}</div>
                </div>
              ))}
            </div>
          )}

          {built?.sections.map((s, si) => (
            <div key={si} className="report-section">
              {s.title && <h3>{s.title}</h3>}
              {s.rows.length === 0 ? (
                <p className="empty-state">{t(report === 'unpaid' ? 'reports.emptyUnpaid' : 'reports.empty')}</p>
              ) : (
                <ul className={`pet-list data-table ${s.cls}`}>
                  <li className="data-head" aria-hidden>
                    {s.head.map((h, i) => (
                      <span key={i} className={s.kinds[i] === 'money' || s.kinds[i] === 'count' ? 'data-num' : undefined}>
                        {h}
                      </span>
                    ))}
                  </li>
                  {[...s.rows, ...(s.foot ? [s.foot] : [])].map((row, ri) => (
                    <li key={ri} className={`pet-list-item${ri === s.rows.length ? ' report-foot' : ''}`}>
                      <div className="pet-row data-row">
                        {row.map((v, i) => {
                          const k = s.kinds[i]
                          const num = k === 'money' || k === 'count'
                          const text = show(v, k)
                          if (!text && !num) return <span key={i} className="report-blank" />
                          return (
                            <span key={i} className={num ? 'data-num' : i === 0 ? 'data-strong' : undefined}>
                              {i > 0 && <span className="data-label">{s.head[i]}: </span>}
                              {k === 'text' ? text : <Ltr>{text}</Ltr>}
                            </span>
                          )
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default ReportsPage
