import type { ReactNode } from 'react'

// Wraps content that must always read left-to-right regardless of the
// active UI language — phone numbers, dates/times, counts. `dir="ltr"`
// creates a bidi isolate so digits and punctuation (e.g. "5/14/2026, 3:00 PM")
// don't get visually reordered when embedded in Arabic (RTL) text.
function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={className}>
      {children}
    </span>
  )
}

export default Ltr
