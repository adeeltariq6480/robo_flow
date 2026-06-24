-- Annotation review workflow for dataset files
-- Run AFTER 20240625000000_worker_jobs.sql

do $$ begin
  create type public.review_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

alter table public.dataset_files
  add column if not exists review_status public.review_status;

alter table public.dataset_files
  add column if not exists reviewed_at timestamptz;

create index if not exists idx_dataset_files_review
  on public.dataset_files (dataset_id, review_status);

create index if not exists idx_dataset_files_auto_labeled
  on public.dataset_files (dataset_id, auto_labeled_at)
  where auto_labeled_at is not null;

-- Auto-labeled files enter the review queue as pending
create or replace function public.set_pending_review_on_auto_label()
returns trigger as $$
begin
  if new.auto_labeled_at is not null
     and (old.auto_labeled_at is distinct from new.auto_labeled_at)
     and new.review_status is null then
    new.review_status := 'pending';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists dataset_files_auto_label_review on public.dataset_files;
create trigger dataset_files_auto_label_review
  before insert or update on public.dataset_files
  for each row execute function public.set_pending_review_on_auto_label();
