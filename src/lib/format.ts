// One display format for dates, times and money across the app, so the same
// value never shows as "9/21/2026" on one screen and "21/09/2026" on another.
// Month names avoid the day/month ambiguity; en-US matches the calendar's labels.

const DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

// A bare "2026-09-21" (date columns) is a calendar day, not UTC midnight;
// new Date() would read it as UTC and can show the previous day.
function toDate(value: string | Date): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

export const formatDate = (value: string | Date) => toDate(value).toLocaleDateString('en-US', DATE)

export const formatDateTime = (value: string | Date) => toDate(value).toLocaleString('en-US', { ...DATE, ...TIME })

// yyyy-mm-dd for CSV exports, which spreadsheets read reliably.
export const formatIsoDate = (value: string | Date) => toDate(value).toLocaleDateString('en-CA')

export const formatMoney = (amount: number) =>
  amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
