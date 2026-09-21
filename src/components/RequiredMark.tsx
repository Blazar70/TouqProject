// Purely visual — the underlying <input required> already carries the
// semantic for screen readers, so this asterisk stays out of that
// announcement rather than doubling up on it.
function RequiredMark() {
  return (
    <span className="required-mark" aria-hidden="true">
      {' '}
      *
    </span>
  )
}

export default RequiredMark
