-- Touq / طوق — storage.buckets has RLS enabled by default with zero
-- policies. Handling an upload likely requires Storage API to read the
-- bucket's own row (public flag, size limit) under the authenticated
-- role's RLS-scoped connection; with no SELECT policy, that read is
-- silently filtered to nothing.
create policy "buckets_select_all" on storage.buckets
  for select
  using (true);
