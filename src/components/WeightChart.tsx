import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { formatDate } from '../lib/format'
import { weightPoints } from '../lib/weightPoints'
import type { WeightPoint } from '../lib/weightPoints'

const W = 300
const H = 110
const PAD = 12

// Weight over time from visit records and hospital-stay updates (clinicians only: visit records are theirs, 0087).
function WeightChart({ petId }: { petId: string }) {
  const { t } = useLanguage()
  const [points, setPoints] = useState<WeightPoint[]>([])

  useEffect(() => {
    Promise.all([
      supabase.from('medical_records').select('visit_date, weight_kg').eq('pet_id', petId).not('weight_kg', 'is', null),
      supabase
        .from('inpatient_updates')
        .select('created_at, weight_kg, inpatient_stays!inner(pet_id)')
        .eq('inpatient_stays.pet_id', petId)
        .not('weight_kg', 'is', null),
    ]).then(([records, updates]) => setPoints(weightPoints(records.data ?? [], updates.data ?? [])))
  }, [petId])

  if (points.length === 0) return null
  const last = points[points.length - 1]
  const times = points.map((p) => new Date(p.at).getTime())
  const kgs = points.map((p) => p.kg)
  const [t0, t1] = [Math.min(...times), Math.max(...times)]
  const [k0, k1] = [Math.min(...kgs), Math.max(...kgs)]
  const x = (time: number) => (t1 === t0 ? W / 2 : PAD + ((time - t0) / (t1 - t0)) * (W - 2 * PAD))
  // More than 10% since the weighing before: flagged in text and on the last point (nightly H36).
  const prev = points.length > 1 ? points[points.length - 2].kg : null
  const changePct = prev ? Math.round(((last.kg - prev) / prev) * 100) : 0
  const bigChange = Math.abs(changePct) > 10
  const y = (kg: number) => (k1 === k0 ? H / 2 : H - PAD - ((kg - k0) / (k1 - k0)) * (H - 2 * PAD))

  return (
    <section className="weight-chart">
      <div className="panel-header">
        <h3>{t('weight.title')}</h3>
        <span className="pet-file-meta">
          {t('weight.latest')}: {t('weight.kg', { value: String(last.kg) })}
          {bigChange && (
            <strong className="weight-chart-alert">
              {' '}
              {t('weight.bigChange', { pct: `${changePct > 0 ? '+' : ''}${changePct}%` })}
            </strong>
          )}
        </span>
      </div>
      {points.length > 1 && (
        <p className="weight-chart-range">
          {t('weight.range')}: <bdi dir="ltr">{k0} – {k1}</bdi> {t('weight.unit')}
        </p>
      )}
      {points.length > 1 && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="weight-chart-plot" aria-hidden="true">
            <line x1={PAD} x2={W - PAD} y1={y(k0)} y2={y(k0)} className="weight-chart-base" />
            <polyline points={points.map((p, i) => `${x(times[i])},${y(p.kg)}`).join(' ')} className="weight-chart-line" />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={x(times[i])}
                cy={y(p.kg)}
                r={4}
                className={`weight-chart-dot${bigChange && i === points.length - 1 ? ' weight-chart-dot-alert' : ''}`}
              >
                <title>{`${formatDate(p.at)}: ${t('weight.kg', { value: String(p.kg) })}`}</title>
              </circle>
            ))}
          </svg>
          {/* time runs left to right in both languages, like the plot */}
          <div className="weight-chart-axis" dir="ltr">
            {/* bdi: an Arabic date inside this left-to-right row keeps its own order */}
            <bdi>{formatDate(points[0].at)}</bdi>
            <bdi>{formatDate(last.at)}</bdi>
          </div>
        </>
      )}
      <details className="weight-chart-table">
        <summary>{t('weight.showAll')}</summary>
        <ul className="record-list">
          {[...points].reverse().map((p, i) => (
            <li key={i}>
              {formatDate(p.at)}: {t('weight.kg', { value: String(p.kg) })}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

export default WeightChart
