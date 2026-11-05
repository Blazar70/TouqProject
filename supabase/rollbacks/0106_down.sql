-- Undo 0106.
drop function public.report_top_diagnoses(date, date, uuid);
drop trigger medical_records_match_term on medical_records;
drop function public.medical_records_match_term();
alter table medical_records drop column diagnosis_term_id;
drop table diagnosis_terms;
