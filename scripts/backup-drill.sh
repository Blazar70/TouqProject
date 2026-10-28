#!/usr/bin/env bash
# Backup restore drill (user 10-29): a backup counts only once it has been restored somewhere and checked.
#   dump    <source_db_url> <dir>   full custom-format pg_dump + per-table row counts of the source
#   restore <dir> <target_db_url>   restore into an EMPTY Supabase project (needs its auth schema/roles), then compare
# Never point "restore" at staging or live. Needs pg_dump/pg_restore/psql 17 on PATH (PostgreSQL 17 bin).
set -euo pipefail

counts() {
  # Exact row count of every public table, one "table|rows" line each, sorted.
  psql "$1" -tA -v ON_ERROR_STOP=1 <<'SQL'
select format('select %L || ''|'' || count(*) from public.%I', tablename, tablename)
from pg_tables where schemaname = 'public' order by tablename \gexec
SQL
}

case "${1:-}" in
  dump)
    src="$2"; dir="$3"; mkdir -p "$dir"
    pg_dump "$src" -Fc --no-owner --no-privileges -n public -f "$dir/public.dump"
    counts "$src" > "$dir/counts-source.txt"
    pg_restore --list "$dir/public.dump" > /dev/null # proves the file is readable
    echo "dump ok: $(du -h "$dir/public.dump" | cut -f1), $(wc -l < "$dir/counts-source.txt") tables"
    ;;
  restore)
    dir="$2"; target="$3"
    if psql "$target" -tAc "select count(*) from pg_tables where schemaname = 'public'" | grep -qv '^0$'; then
      echo "target already has public tables; use an empty project" >&2; exit 1
    fi
    psql "$target" -v ON_ERROR_STOP=1 -c 'drop schema if exists public cascade'
    pg_restore -d "$target" --no-owner --no-privileges --exit-on-error "$dir/public.dump"
    counts "$target" > "$dir/counts-target.txt"
    if diff "$dir/counts-source.txt" "$dir/counts-target.txt"; then
      echo "restore ok: every table has the same row count"
    else
      echo "restore MISMATCH: see the diff above" >&2; exit 1
    fi
    ;;
  *)
    echo "usage: $0 dump <source_db_url> <dir> | restore <dir> <target_db_url>" >&2; exit 2
    ;;
esac
