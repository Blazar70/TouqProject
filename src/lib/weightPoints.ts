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
