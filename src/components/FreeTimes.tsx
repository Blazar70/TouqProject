import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { clinicMidnight, formatTime } from '../lib/format'
import { freeSlots } from '../lib/timeOff'
import type { AwayPeriod } from '../lib/timeOff'
import { useLanguage } from '../lib/i18n/LanguageContext'

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

  useEffect(() => {
    setSlots(null)
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
      {slots.length > 0 && (
        <div className="free-times-list">
          {slots.map((iso) => (
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
        </div>
      )}
    </div>
  )
}

export default FreeTimes
