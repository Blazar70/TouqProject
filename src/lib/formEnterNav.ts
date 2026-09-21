import type { KeyboardEvent } from 'react'

// Pressing Enter in a field normally submits the form immediately. This
// makes Enter step to the next field instead, and only submit once you're
// on the last one — closer to how filling out a paper form feels.
export function handleEnterAdvance(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== 'Enter') return

  const target = e.target as HTMLElement
  // Let textareas keep their normal newline behavior, and let buttons
  // (the species dropdown trigger, Cancel, etc.) keep their normal click.
  if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return

  e.preventDefault()

  const form = e.currentTarget
  const focusable = Array.from(
    form.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button[type="submit"]',
    ),
  ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)

  const index = focusable.indexOf(target)
  if (index === -1) return

  if (index < focusable.length - 1) {
    focusable[index + 1].focus()
  } else {
    form.requestSubmit()
  }
}
