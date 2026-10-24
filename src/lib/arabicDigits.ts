// Tablets set to Arabic type Arabic-Indic digits (٣٨٫٥) and may use a comma
// as the decimal separator; turn those into a plain "38.5".
export function toLatinDigits(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
}

// A number field silently drops Arabic digits (money, quantity, discount boxes:
// nightly H6). Catch them before the browser does and type the Latin digit instead.
// insertText lets the browser place it, so a selected "1" is replaced, not appended to (nightly B10):
// number fields expose no cursor or selection to do it by hand. Append only if insertText is refused.
export function installArabicDigitInput() {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  document.addEventListener(
    'beforeinput',
    (e) => {
      const input = e.target
      if (!(input instanceof HTMLInputElement) || input.type !== 'number' || !e.data) return
      const latin = toLatinDigits(e.data)
      if (latin === e.data) return
      e.preventDefault()
      if (document.execCommand('insertText', false, latin)) return
      // The native setter + an input event, so React's onChange sees the new value.
      valueSetter?.call(input, input.value + latin)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    true,
  )
}
