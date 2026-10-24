// Owner reminders, tap-to-send (0085): fixed texts, every message Arabic first then English
// (user decision 2026-10-25), opened in WhatsApp through a wa.me link with the text filled in.

export type ReminderClinic = { name: string; phone: string | null }
export type DueVaccine = { pet: string; vaccine: string; due: string }

const LOCALE = { ar: 'ar-SA-u-ca-gregory-nu-latn', en: 'en-US' } as const
type Lang = keyof typeof LOCALE

// A bare yyyy-mm-dd is a clinic day; noon Riyadh keeps it on that day in any device time zone.
const asDate = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+03:00` : value)

function day(value: string, lang: Lang) {
  return asDate(value).toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' })
}

function time(value: string, lang: Lang) {
  return asDate(value).toLocaleTimeString(LOCALE[lang], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' })
}

function contact(clinic: ReminderClinic, lang: Lang) {
  if (!clinic.phone) return ''
  return lang === 'ar' ? `\nللاستفسار: ${clinic.phone}` : `\nQuestions: ${clinic.phone}`
}

const both = (ar: string, en: string) => `${ar}\n\n${en}`

export function vaccineMessage(clinic: ReminderClinic, owner: string, items: DueVaccine[]) {
  const lines = (lang: Lang) => items.map((i) => `- ${i.pet}: ${i.vaccine} (${day(i.due, lang)})`).join('\n')
  return both(
    `مرحبًا ${owner}،\nنذكّركم من ${clinic.name} بمواعيد التطعيم:\n${lines('ar')}\nيسعدنا حجز موعد لكم.${contact(clinic, 'ar')}`,
    `Hello ${owner},\nA reminder from ${clinic.name} that these vaccinations are due:\n${lines('en')}\nWe are happy to book a visit for you.${contact(clinic, 'en')}`,
  )
}

export function appointmentMessage(clinic: ReminderClinic, owner: string, pet: string, at: string, branch: string) {
  return both(
    `مرحبًا ${owner}،\nنذكّركم بموعد ${pet} في ${clinic.name} (${branch}) غدًا ${day(at, 'ar')} الساعة ${time(at, 'ar')}.${contact(clinic, 'ar')}`,
    `Hello ${owner},\nA reminder of ${pet}'s appointment at ${clinic.name} (${branch}) tomorrow, ${day(at, 'en')} at ${time(at, 'en')}.${contact(clinic, 'en')}`,
  )
}

export function pickupMessage(clinic: ReminderClinic, owner: string, pet: string, branch: string) {
  return both(
    `مرحبًا ${owner}،\n${pet} جاهز للعودة إلى المنزل. يمكنكم استلامه من ${clinic.name} (${branch}).${contact(clinic, 'ar')}`,
    `Hello ${owner},\n${pet} is ready to go home. You can pick them up at ${clinic.name} (${branch}).${contact(clinic, 'en')}`,
  )
}

// wa.me wants the international number in digits only. Stored numbers are "+9665…"; an old "05…" is local.
export function whatsAppLink(phone: string | null, text: string) {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('05')) digits = `966${digits.slice(1)}`
  if (digits.length < 8) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
