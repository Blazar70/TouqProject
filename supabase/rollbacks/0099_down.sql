-- Undo 0099: nothing to undo on a project that still has the old default grants (they were already in place).
-- On a project without them, removing these grants would cut the app off; don't.
select 1;
