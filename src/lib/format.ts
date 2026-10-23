import 'dayjs/locale/ar-sa'
// One display format for dates, times and money across the app, so the same
// value never shows as "9/21/2026" on one screen and "21/09/2026" on another.
// Month names avoid the day/month ambiguity. Dates follow the app language like the calendar;
// Arabic stays Gregorian with Latin digits (ar-SA would default to Hijri).

let displayLocale = 'en-US'
// Called by LanguageProvider on every render, before any child formats a date.
export function setDisplayLanguage(language: string) {
  displayLocale = language === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US'
}

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

export const formatDate = (value: string | Date) => toDate(value).toLocaleDateString(displayLocale, DATE)

export const formatTime = (value: string | Date) => toDate(value).toLocaleTimeString(displayLocale, TIME)

export const formatDateTime = (value: string | Date) => toDate(value).toLocaleString(displayLocale, { ...DATE, ...TIME })

// yyyy-mm-dd for CSV exports, which spreadsheets read reliably.
export const formatIsoDate = (value: string | Date) => toDate(value).toLocaleDateString('en-CA')

// The clinic's calendar day (yyyy-mm-dd) of an instant, not the device's.
// shortcut: fixed to Asia/Riyadh (every clinic's clinics.timezone today), read clinics.timezone once a clinic outside KSA joins.
export const clinicDay = (value: string | Date = new Date()) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })

// The instant a clinic day (yyyy-mm-dd) starts. shortcut: Riyadh is UTC+3 all year (no DST); same upgrade as clinicDay.
export const clinicMidnight = (day: string = clinicDay()) => new Date(`${day}T00:00:00+03:00`)

export const formatMoney =(amount: number) =>
  amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Calendar locale (dayjs): Arabic month/day names with Latin digits, weeks from Sunday.
export const calendarCulture = (language: string) => (language === 'ar' ? 'ar-sa' : 'en')
