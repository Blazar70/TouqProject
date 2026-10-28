import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { monthGrid } from '../lib/monthGrid'
import { calendarCulture, clinicDay } from '../lib/format'

// A known Sunday: weekday headers in the current language, Sunday first like monthGrid.
const SUNDAY = dayjs('2026-10-18')

// Small month picker beside the appointments calendar: click a day to jump there.
// Same language and direction as the main calendar.
function MiniMonth({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const { t, language } = useLanguage()
  const culture = calendarCulture(language)
  const [month, setMonth] = useState(() => dayjs(value).startOf('month'))

  // Follow the main calendar when it moves to another month.
  useEffect(() => {
    setMonth(dayjs(value).startOf('month'))
  }, [value])

  return (
    <div className="mini-month">
      <div className="mini-month-header">
        <button type="button" aria-label={t('calendar.prevMonth')} onClick={() => setMonth((m) => m.subtract(1, 'month'))}>
          <ChevronLeft className="nav-icon-flip" size={18} aria-hidden />
        </button>
        <strong>{month.locale(culture).format('MMMM YYYY')}</strong>
        <button type="button" aria-label={t('calendar.nextMonth')} onClick={() => setMonth((m) => m.add(1, 'month'))}>
          <ChevronRight className="nav-icon-flip" size={18} aria-hidden />
        </button>
      </div>
      <div className="mini-month-grid">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="mini-month-weekday" aria-hidden>
            {SUNDAY.add(i, 'day').locale(culture).format('dd')}
          </span>
        ))}
        {monthGrid(month.toDate()).map((day) => {
          const d = dayjs(day)
          const classes = [
            'mini-month-day',
            d.month() !== month.month() && 'is-other-month',
            d.format('YYYY-MM-DD') === clinicDay() && 'is-today',
            d.isSame(value, 'day') && 'is-selected',
          ]
          return (
            <button
              key={day.getTime()}
              type="button"
              className={classes.filter(Boolean).join(' ')}
              aria-label={d.locale(culture).format('dddd, D MMMM YYYY')}
              aria-pressed={d.isSame(value, 'day')}
              onClick={() => onChange(day)}
            >
              {d.date()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default MiniMonth
