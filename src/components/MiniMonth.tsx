import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { monthGrid } from '../lib/monthGrid'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Small month picker beside the appointments calendar: click a day to jump there.
// English labels and LTR like the main calendar, which stays the same in both languages.
function MiniMonth({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const { t } = useLanguage()
  const [month, setMonth] = useState(() => dayjs(value).startOf('month'))

  // Follow the main calendar when it moves to another month.
  useEffect(() => {
    setMonth(dayjs(value).startOf('month'))
  }, [value])

  return (
    <div className="mini-month" dir="ltr">
      <div className="mini-month-header">
        <button type="button" aria-label={t('calendar.prevMonth')} onClick={() => setMonth((m) => m.subtract(1, 'month'))}>
          <ChevronLeft size={18} aria-hidden />
        </button>
        <strong>{month.format('MMMM YYYY')}</strong>
        <button type="button" aria-label={t('calendar.nextMonth')} onClick={() => setMonth((m) => m.add(1, 'month'))}>
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>
      <div className="mini-month-grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="mini-month-weekday" aria-hidden>
            {d}
          </span>
        ))}
        {monthGrid(month.toDate()).map((day) => {
          const d = dayjs(day)
          const classes = [
            'mini-month-day',
            d.month() !== month.month() && 'is-other-month',
            d.isSame(dayjs(), 'day') && 'is-today',
            d.isSame(value, 'day') && 'is-selected',
          ]
          return (
            <button
              key={day.getTime()}
              type="button"
              className={classes.filter(Boolean).join(' ')}
              aria-label={d.format('dddd, D MMMM YYYY')}
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
