import { useState } from 'react'
import { SAUDI_MOBILE_MAX_DIGITS, formatSaudiPhoneInput, isValidSaudiMobile } from '../lib/phone'

type PhoneInputProps = {
  value: string
  onChange: (digits: string) => void
  invalidMessage: string
  autoFocus?: boolean
  required?: boolean
}

// Shared by every form that collects a Saudi mobile number (pet owner, staff,
// trusted contact) so the format error shows up the moment the field is left
// (on blur) instead of only after a failed submit. When `required`, leaving
// it blank counts as invalid too, not just a malformed number.
function PhoneInput({ value, onChange, invalidMessage, autoFocus, required }: PhoneInputProps) {
  const [touched, setTouched] = useState(false)
  const showError = touched && ((required && value === '') || (value !== '' && !isValidSaudiMobile(value)))

  return (
    <>
      <div className="phone-input">
        <span className="phone-prefix">+966</span>
        <input
          value={value}
          onChange={(e) => onChange(formatSaudiPhoneInput(e.target.value))}
          onBlur={() => setTouched(true)}
          placeholder="5X-XXX-XXXX"
          dir="ltr"
          inputMode="numeric"
          maxLength={SAUDI_MOBILE_MAX_DIGITS}
          autoFocus={autoFocus}
          required={required}
          aria-invalid={showError}
        />
      </div>
      {showError && <p className="field-error">{invalidMessage}</p>}
    </>
  )
}

export default PhoneInput
