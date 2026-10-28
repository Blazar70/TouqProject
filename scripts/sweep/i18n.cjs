// Reads a UI text from the app's translations.ts, so scripts can find buttons in either language.
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.resolve(__dirname, '../../src/lib/i18n/translations.ts'), 'utf8')
const arStart = source.indexOf('\n  ar: {')

function text(lang, key) {
  const section = lang === 'ar' ? source.slice(arStart) : source.slice(0, arStart)
  const at = section.indexOf(`'${key}':`)
  if (at < 0) throw new Error('no translation for ' + key)
  const rest = section.slice(at + key.length + 3).trimStart()
  const quote = rest[0]
  let out = ''
  for (let i = 1; i < rest.length && rest[i] !== quote; i++) out += rest[i] === '\\' ? rest[++i] : rest[i]
  return out.replace(/\{[^}]+\}/g, '').trim() // "{branch}" placeholders dropped: match the fixed part
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A regex for a button: exact (allowing a leading "+") or "contains".
function button(lang, key, exact = false) {
  const t = escape(text(lang, key))
  return new RegExp(exact ? `^\\+?\\s*${t}$` : t)
}

module.exports = { text, button }
