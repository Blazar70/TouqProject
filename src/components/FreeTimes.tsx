import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { clinicMidnight, formatTime } from '../lib/format'
import { freeSlots, slotPeriod } from '../lib/timeOff'
import type { AwayPeriod, SlotPeriod } from '../lib/timeOff'
import { useLanguage } from '../lib/i18n/LanguageContext'

// A row of chips per part of the day; the rest behind "+N more" (H53).
const SHOWN_PER_PERIOD = 6
const PERIODS: { period: SlotPeriod; label: 'appointments.morning' | 'appointments.afternoon' | 'appointments.evening' }[] = [
  { period: 'morning', label: 'appointments.morning' },
  { period: 'afternoon', label: 'appointments.afternoon' },
  { period: 'evening', label: 'appointments.evening' },
]

// H49: the doctor's free times on the chosen day as tap targets; one tap fills hour, minute and AM/PM.
// Its own query: the calendar only holds the day or week on screen, the booking date can be any day.
function FreeTimes({
  day,
  doctorId,
  away,
  selected,
  onPick,
}: {
  day: string
  doctorId: string
  away: AwayPeriod[]
  selected: string | null
  onPick: (iso: string) => void
}) {
  const { t } = useLanguage()
  const [slots, setSlots] = useState<string[] | null>(null)
  const [expanded, setExpanded] = useState<SlotPeriod[]>([])

  useEffect(() => {
    setSlots(null)
    setExpanded([])
    let live = true
    const start = clinicMidnight(day)
    supabase
      .from('appointments')
      .select('scheduled_at')
      .eq('doctor_id', doctorId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', start.toISOString())
      .lt('scheduled_at', new Date(start.getTime() + 86_400_000).toISOString())
      .then(({ data, error }) => {
        // On a failed read show nothing rather than times that may be taken; the save still checks conflicts.
        if (live) setSlots(error ? [] : freeSlots(day, doctorId, (data ?? []).map((a) => a.scheduled_at), away))
      })
    return () => {
      live = false
    }
  }, [day, doctorId, away])

  if (slots === null) return null
  return (
    <div className="free-times">
      <span className="pet-owner">{slots.length ? t('appointments.freeTimes') : t('appointments.noFreeTimes')}</span>
      {PERIODS.map(({ period, label }) => {
        const inPeriod = slots.filter((iso) => slotPeriod(iso) === period)
        if (inPeriod.length === 0) return null
        const open = expanded.includes(period)
        const hidden = open ? 0 : Math.max(0, inPeriod.length - SHOWN_PER_PERIOD)
        return (
          <div key={period} className="free-times-group">
            <span className="pet-owner">{t(label)}</span>
            <div className="free-times-list">
              {inPeriod
                .filter((iso, i) => open || i < SHOWN_PER_PERIOD || iso === selected)
                .map((iso) => (
                  <button
                    key={iso}
                    type="button"
                    className={`secondary-button${iso === selected ? ' free-time-picked' : ''}`}
                    aria-pressed={iso === selected}
                    onClick={() => onPick(iso)}
                  >
                    {formatTime(iso)}
                  </button>
                ))}
              {hidden > 0 && (
                <button type="button" className="secondary-button" onClick={() => setExpanded((current) => [...current, period])}>
                  {t('appointments.freeMore', { count: String(hidden) })}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default FreeTimes
