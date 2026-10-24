-- Touq / طوق — Manager page (/manager): whole-clinic managers read their clinic's activity log,
-- and every manager gets the cash count differences of a date range in one call.

-- Log rows carry no branch, so branch managers don't get them (they would see other branches' events).
create policy admin_audit_log_select_clinic_manager on admin_audit_log
  for select using (
    clinic_id = (select public.current_user_clinic_id())
    and (select public.current_user_is_clinic_manager())
  );

-- Latest count per branch and day against that day's expected cash (the cash line of the cash-up
-- report, as CashCountPanel shows it). counts = how many times that day was counted (0073 keeps all).
create function public.report_cash_differences(p_from date, p_to date, p_branch uuid default null)
returns table (day date, branch_id uuid, counted numeric, expected numeric, difference numeric, counter_name text, counts integer)
language sql stable
set search_path = public
as $$
  select public.require_clinic_role(array['manager'], 'Only managers can see income and VAT reports');
  with latest as (
    select distinct on (k.branch_id, k.day)
      k.branch_id, k.day, k.counted, k.counted_by,
      (count(*) over (partition by k.branch_id, k.day))::integer as counts
    from cash_counts k
    where k.clinic_id = public.current_user_clinic_id()
      and k.day between p_from and p_to
      and (p_branch is null or k.branch_id = p_branch)
    order by k.branch_id, k.day, k.counted_at desc
  )
  select l.day, l.branch_id, l.counted, coalesce(e.net, 0), l.counted - coalesce(e.net, 0), p.full_name, l.counts
  from latest l
  left join lateral (select r.net from public.report_cash_up(l.day, l.branch_id) r where r.method = 'cash') e on true
  left join profiles p on p.id = l.counted_by
  order by l.day desc, l.branch_id;
$$;

revoke execute on function public.report_cash_differences(date, date, uuid) from public, anon;
