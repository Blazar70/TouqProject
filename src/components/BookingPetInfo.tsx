import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { visitTypeLabel } from '../lib/visitTypes'
import { addDays, DUE_SOON_WINDOW_DAYS, vaccinationStatus } from '../lib/vaccination'
import { clinicDay, formatDate, formatDateTime } from '../lib/format'
import Ltr from './Ltr'

type Pet = Database['public']['Tables']['pets']['Row']
type Info = {
  lastVisit: { visit_date: string; visit_type: string | null; vet: { full_name: string } | null } | null
  upcoming: { id: string; scheduled_at: string; doctor: { full_name: string } | null }[]
  due: { id: string; next_due_date: string; vaccine: { name: string } | null }[]
}

// Shown in the booking pop-up once a pet is picked: who to call, last visit,
// bookings it already has (no double booking), vaccines due. Information only.
function BookingPetInfo({ pet }: { pet: Pet }) {
  const { t } = useLanguage()
  const [info, setInfo] = useState<Info | null>(null)

  useEffect(() => {
    let stale = false
    setInfo(null)
    Promise.all([
      supabase
        .from('medical_records')
        .select('visit_date, visit_type, vet:profiles!medical_records_vet_id_fkey(full_name)')
        .eq('pet_id', pet.id)
        .order('visit_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('appointments')
        .select('id, scheduled_at, doctor:profiles!appointments_doctor_fkey(full_name)')
        .eq('pet_id', pet.id)
        .in('status', ['requested', 'confirmed', 'arrived'])
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at')
        .limit(3),
      supabase
        .from('pet_vaccines')
        .select('id, next_due_date, vaccine:vaccines(name)')
        .eq('pet_id', pet.id)
        .lte('next_due_date', addDays(clinicDay(), DUE_SOON_WINDOW_DAYS))
        .order('next_due_date'),
    ]).then(([last, upcoming, due]) => {
      if (stale) return
      setInfo({
        lastVisit: (last.data as Info['lastVisit']) ?? null,
        upcoming: (upcoming.data as Info['upcoming']) ?? [],
        due: (due.data as Info['due']) ?? [],
      })
    })
    return () => {
      stale = true
    }
  }, [pet.id])

  return (
    <div className="booking-pet-info" role="status">
      <div>
        {t('pets.owner')}: {pet.owner_name}
        {pet.owner_phone && (
          <>
            {' · '}
            <a href={`tel:${pet.owner_phone}`}>
              <Ltr>{pet.owner_phone}</Ltr>
            </a>
          </>
        )}
      </div>
      {info && (
        <>
          <div>
            {t('booking.lastVisit')}:{' '}
            {info.lastVisit ? (
              <>
                <Ltr>{formatDate(info.lastVisit.visit_date)}</Ltr>
                {info.lastVisit.visit_type && ` · ${visitTypeLabel(t, info.lastVisit.visit_type)}`}
                {info.lastVisit.vet && ` · ${info.lastVisit.vet.full_name}`}
              </>
            ) : (
              t('booking.noVisits')
            )}
          </div>
          {info.upcoming.map((a) => (
            <div key={a.id} className="booking-pet-info-warn">
              {t('booking.alreadyBooked', { name: pet.name })} <Ltr>{formatDateTime(a.scheduled_at)}</Ltr>
              {a.doctor && ` · ${a.doctor.full_name}`}
            </div>
          ))}
          {info.due.map((d) => (
            <div key={d.id} className={vaccinationStatus(d.next_due_date) === 'overdue' ? 'booking-pet-info-warn' : undefined}>
              {t('booking.vaccineDue', { name: d.vaccine?.name ?? '' })} <Ltr>{formatDate(d.next_due_date)}</Ltr>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default BookingPetInfo
