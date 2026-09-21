// A plain CSS bar chart — pulling in a charting library for one bar chart
// on an admin page isn't worth the bundle weight. Bar heights are relative
// to the largest value in the set; each bar's exact count is in its title
// (tooltip) and visually-hidden text for screen readers.
function SimpleBarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))

  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div key={d.label} className="bar-chart-col" title={`${d.label}: ${d.value}`}>
          <div className="bar-chart-bar" style={{ height: `${(d.value / max) * 100}%` }}>
            <span className="bar-chart-value">{d.value}</span>
          </div>
          <div className="bar-chart-label">{d.label}</div>
        </div>
      ))}
    </div>
  )
}

export default SimpleBarChart
