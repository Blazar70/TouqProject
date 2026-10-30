export type WeightPoint = { at: string; kg: number }

// Visit records and hospital-stay updates merged into one oldest-first series.
export function weightPoints(
  records: { visit_date: string; weight_kg: number | null }[],
  updates: { created_at: string; weight_kg: number | null }[],
): WeightPoint[] {
  return [
    ...records.map((r) => ({ at: r.visit_date, kg: r.weight_kg })),
    ...updates.map((u) => ({ at: u.created_at, kg: u.weight_kg })),
  ]
    .filter((p): p is WeightPoint => p.kg !== null)
    .map((p) => ({ at: p.at, kg: Number(p.kg) }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

// Change since the weighing before (nightly H36/H40). Over 10% is flagged, but for a pet under 12 months
// (or of unknown age with fewer than 3 weighings) only a LOSS is: puppies and kittens gain 10–30% between visits.
export function weightChange(points: WeightPoint[], dateOfBirth: string | null) {
  if (points.length < 2) return null
  const prev = points[points.length - 2]
  const last = points[points.length - 1]
  const kg = Math.round((last.kg - prev.kg) * 100) / 100
  const pct = Math.round((kg / prev.kg) * 100)
  const monthsOld = dateOfBirth ? (new Date(last.at).getTime() - new Date(dateOfBirth).getTime()) / (30.44 * 86_400_000) : null
  const young = monthsOld === null ? points.length < 3 : monthsOld < 12
  return { kg, pct, flag: young ? pct < -10 : Math.abs(pct) > 10 }
}
