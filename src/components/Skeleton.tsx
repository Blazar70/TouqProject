function Skeleton({ width, height = '1em' }: { width: string | number; height?: string | number }) {
  return <span className="skeleton" style={{ width, height }} />
}

// Mimics the shape of a .pet-list / .record-list row while data loads.
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="pet-list">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="pet-list-item">
          <div className="pet-row">
            <div className="skeleton-row-content">
              <Skeleton width="40%" height="1rem" />
              <Skeleton width="60%" height="0.8rem" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// A list page while its data loads (UI tip 1): the real title and grey rows in place of the list, instead of a
// blank screen with a spinner, so the page shows where things will be.
export function PageSkeleton({ title }: { title: string }) {
  return (
    <div aria-busy="true">
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <ListSkeleton rows={6} />
    </div>
  )
}

export default Skeleton
