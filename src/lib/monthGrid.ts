import dayjs from 'dayjs'

// The 6 weeks (42 days) shown for `month`, starting on Sunday like the
// Saudi work week, so every month has the same grid height.
export function monthGrid(month: Date): Date[] {
  const first = dayjs(month).startOf('month')
  const start = first.subtract(first.day(), 'day')
  return Array.from({ length: 42 }, (_, i) => start.add(i, 'day').toDate())
}
