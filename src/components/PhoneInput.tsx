import { useId, useState } from 'react'
import { formatSaudiPhoneInput, isValidSaudiMobile } from '../lib/phone'

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
  const errorId = useId()
  const showError = touched && ((required && value === '') || (value !== '' && !isValidSaudiMobile(value)))

  return (
    // A single wrapping element, not a fragment — the label CSS styles
    // "the label's last child" as the form control, and a fragment here
    // would let the conditional error message become that last child
    // instead whenever it's shown.
    <div>
      <div className="phone-input">
        <span className="phone-prefix">+966</span>
        <input
          value={value}
          onChange={(e) => onChange(formatSaudiPhoneInput(e.target.value))}
          onBlur={() => setTouched(true)}
          placeholder="5X-XXX-XXXX"
          dir="ltr"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          required={required}
          aria-invalid={showError}
          aria-describedby={showError ? errorId : undefined}
        />
      </div>
      {showError && (
        <p className="field-error" id={errorId} role="alert">
          {invalidMessage}
        </p>
      )}
    </div>
  )
}

export default PhoneInput
