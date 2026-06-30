-- Allow multiple classes with the same name in one project (e.g. five "person" classes).

alter table public.classes
  drop constraint if exists classes_project_id_name_key;
