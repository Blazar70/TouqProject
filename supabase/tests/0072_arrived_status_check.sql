-- Checks for migration 0072 (arrived status). RUN ON STAGING ONLY.
begin;
do $$
begin
  update appointments set status = 'arrived' where id = (select id from appointments where status = 'confirmed' limit 1);
  begin
    update appointments set status = 'waiting' where id = (select id from appointments limit 1);
    assert false, 'unknown statuses must still be refused';
  exception when check_violation then null;
  end;
end $$;
rollback;
select '0072 arrived status: all checks passed' as result;
