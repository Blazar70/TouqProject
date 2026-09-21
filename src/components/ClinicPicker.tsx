import { useEffect, useMemo, useState } from 'react'
import type { Database } from '../lib/database.types'
import { useLanguage } from '../lib/i18n/LanguageContext'

type Clinic = Database['public']['Tables']['clinics']['Row']

function ClinicPicker({
  clinics,
  value,
  onChange,
}: {
  clinics: Clinic[]
  value: string
  onChange: (clinicId: string) => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const selectedClinic = clinics.find((c) => c.id === value)

  useEffect(() => {
    setQuery(selectedClinic ? selectedClinic.name : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClinic?.id])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || selectedClinic) return []
    return clinics.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [clinics, query, selectedClinic])

  function handleSelect(clinic: Clinic) {
    onChange(clinic.id)
    setQuery(clinic.name)
    setOpen(false)
  }

  function handleChange(next: string) {
    setQuery(next)
    if (value) onChange('')
    setOpen(true)
  }

  return (
    <div className="pet-picker">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t('admin.paymentSelectClinic')}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul className="pet-picker-results">
          {matches.map((clinic) => (
            <li key={clinic.id}>
              <button type="button" onMouseDown={() => handleSelect(clinic)}>
                <span className="pet-picker-title">
                  <strong>{clinic.name}</strong>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && !selectedClinic && matches.length === 0 && (
        <div className="pet-picker-empty">{t('admin.noClinicMatch', { query })}</div>
      )}
    </div>
  )
}

export default ClinicPicker
