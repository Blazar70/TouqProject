import type { ReactNode } from 'react'

// Wraps phone numbers, dates/times, IDs and amounts so they aren't reordered
// inside the surrounding text. dir="auto" isolates them: digits-only values
// (phones, IDs, money) stay left-to-right, while an Arabic date ("23 أكتوبر 2026")
// keeps its own right-to-left order (calendar and dates follow the language, 2026-10-23).
function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="auto" className={className}>
      {children}
    </span>
  )
}

export default Ltr
