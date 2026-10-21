import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { priceWithVat } from '../lib/vat'
import { formatMoney } from '../lib/format'
import { visitTotal, visitUnitPrice } from '../lib/visitServices'
import Ltr from './Ltr'

type Row = Database['public']['Tables']['appointment_services']['Row']
type Service = Database['public']['Tables']['services']['Row']

// The services given on one visit. Prices come from the price list (copied by
// the DB); only quantity is editable, and nothing once the visit is billed.
function VisitServices({ appointmentId, locked }: { appointmentId: string; locked: boolean }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [serviceId, setServiceId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase
      .from('appointment_services')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setRows(data ?? [])
      })
    if (!locked) {
      supabase
        .from('services')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true })
        .then(({ data }) => setServices(data ?? []))
    }
    // toast is a new object every render; it's only used to report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, locked])

  async function handleAdd() {
    const qty = parseInt(quantity, 10)
    if (!serviceId || !(qty > 0)) return
    setBusy(true)
    const { data, error } = await supabase
      .from('appointment_services')
      .insert({ appointment_id: appointmentId, service_id: serviceId, quantity: qty })
      .select()
      .single()
    setBusy(false)
    if (error || !data) return toast.error(error?.message ?? t('common.couldNotSave'))
    setRows((current) => [...(current ?? []), data])
    setServiceId('')
    setQuantity('1')
  }

  async function handleQuantity(row: Row, value: string) {
    const qty = parseInt(value, 10)
    if (!(qty > 0) || qty === row.quantity) return
    const { error } = await supabase.from('appointment_services').update({ quantity: qty }).eq('id', row.id)
    if (error) return toast.error(error.message)
    setRows((current) => current?.map((r) => (r.id === row.id ? { ...r, quantity: qty } : r)) ?? null)
  }

  async function handleRemove(row: Row) {
    const { error } = await supabase.from('appointment_services').delete().eq('id', row.id)
    if (error) return toast.error(error.message)
    setRows((current) => current?.filter((r) => r.id !== row.id) ?? null)
  }

  if (rows === null) return <p className="pet-owner">{t('common.loading')}</p>
  if (locked && rows.length === 0) return null

  return (
    <section className="visit-services" aria-labelledby={`visit-services-${appointmentId}`}>
      <p className="pending-action-title" id={`visit-services-${appointmentId}`}>
        {t('visitServices.title')}
      </p>
      {rows.length === 0 ? (
        <p className="pet-owner">{t('visitServices.none')}</p>
      ) : (
        <ul className="visit-services-list">
          {rows.map((row) => (
            <li key={row.id} className="invoice-item-row">
              <span className="visit-services-name">{row.description}</span>
              {locked ? (
                <span className="visit-services-qty">
                  × <Ltr>{row.quantity}</Ltr>
                </span>
              ) : (
                <input
                  type="number"
                  className="no-spinner visit-services-qty"
                  dir="ltr"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  defaultValue={row.quantity}
                  onBlur={(e) => handleQuantity(row, e.target.value)}
                  aria-label={t('visitServices.quantityFor', { name: row.description })}
                />
              )}
              <span className="visit-services-price">
                <Ltr>{formatMoney(visitUnitPrice(row) * row.quantity)}</Ltr>
              </span>
              {!locked && (
                <button
                  type="button"
                  className="delete-button invoice-item-remove"
                  onClick={() => handleRemove(row)}
                  aria-label={t('visitServices.remove', { name: row.description })}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="invoice-total">
        {t('payments.total')}: <Ltr>{formatMoney(visitTotal(rows))}</Ltr> <span className="money-currency">{t('common.currency')}</span>
      </p>
      {!locked && (
        <div className="invoice-item-row">
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label={t('visitServices.pick')}>
            <option value="">{t('visitServices.pick')}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} — {formatMoney(priceWithVat(service.price, service.vat_rate))} {t('common.currency')}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="no-spinner visit-services-qty"
            dir="ltr"
            inputMode="numeric"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            aria-label={t('payments.quantity')}
          />
          <button type="button" className="secondary-button" onClick={handleAdd} disabled={busy || !serviceId}>
            {t('visitServices.add')}
          </button>
        </div>
      )}
    </section>
  )
}

export default VisitServices
