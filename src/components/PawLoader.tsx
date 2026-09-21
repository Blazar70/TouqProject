function Paw() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="7" cy="6" r="2.1" />
      <circle cx="12" cy="3.8" r="2.3" />
      <circle cx="17" cy="6" r="2.1" />
      <ellipse cx="12" cy="15" rx="6" ry="5.2" />
    </svg>
  )
}

function PawLoader() {
  return (
    <div className="paw-loader" aria-hidden="true">
      <Paw />
      <Paw />
      <Paw />
      <Paw />
    </div>
  )
}

export default PawLoader
