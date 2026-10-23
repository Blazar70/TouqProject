-- Rollback for 0071_cash_counts.sql. LOSES the recorded cash counts.
drop table if exists cash_counts;
drop function if exists public.cash_counts_guard();
notify pgrst, 'reload schema';
