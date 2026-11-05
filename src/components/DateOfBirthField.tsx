import { useState } from 'react'
import { dobFromAge } from '../lib/format'
import { useLanguage } from '../lib/i18n/LanguageContext'

// H59: owners often know only "about 2 years old"; the age fills in an estimated birth date.
// shortcut: the estimate is stored as a normal date, nothing marks it as estimated; add a column if prints need "~2 y".
function DateOfBirthField({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const { t } = useLanguage()
  const [years, setYears] = useState('')
  const [months, setMonths] = useState('')

  function setAge(nextYears: string, nextMonths: string) {
    setYears(nextYears)
    setMonths(nextMonths)
    onChange(nextYears || nextMonths ? dobFromAge(Number(nextYears), Number(nextMonths)) : '')
  }

  return (
    <div className="pet-form-file-field">
      <label>
        {t('registerPet.dateOfBirth')}
        <input
          type="date"
          dir="ltr"
          value={value}
          onChange={(e) => {
            setYears('')
            setMonths('')
            onChange(e.target.value)
          }}
        />
      </label>
      <div className="age-row">
        <label>
          {t('pets.ageYears')}
          <input type="number" inputMode="numeric" className="no-spinner" dir="ltr" min="0" max="40" value={years} onChange={(e) => setAge(e.target.value, months)} />
        </label>
        <label>
          {t('pets.ageMonths')}
          <input type="number" inputMode="numeric" className="no-spinner" dir="ltr" min="0" max="11" value={months} onChange={(e) => setAge(years, e.target.value)} />
        </label>
      </div>
      <span className="pet-owner">{t('pets.ageHint')}</span>
    </div>
  )
}

export default DateOfBirthField
