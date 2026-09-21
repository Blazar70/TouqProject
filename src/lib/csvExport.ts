// Minimal CSV export — no library needed for this small a job. Quotes every
// field and escapes embedded quotes so names/notes with commas don't break
// the file; that's the entire correctness surface CSV has.
function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  return `"${str.replace(/"/g, '""')}"`
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','))
  // Leading BOM so Excel (still the most common opener) detects UTF-8
  // instead of mangling Arabic clinic/owner names.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
