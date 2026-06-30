-- Worker jobs for YOLO inference, auto-labelling, and model comparison
-- Run in Supabase SQL Editor AFTER ml_schema.sql

do $$ begin
  create type public.job_type as enum ('test_run', 'auto_label', 'model_compare');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.job_status as enum (
    'pending', 'queued', 'running', 'completed', 'failed', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.job_queue as enum ('interactive', 'batch', 'compare');
exception when duplicate_object then null;
end $$;

-- Annotations on dataset files (YOLO format + metadata)
alter table public.dataset_files
  add column if not exists annotations jsonb not null default '[]'::jsonb;

alter table public.dataset_files
  add column if not exists auto_labeled_at timestamptz;

-- Main inference job table
create table if not exists public.inference_jobs (
  id               uuid primary key default uuid_generate_v4(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  job_type         public.job_type not null,
  queue_name       public.job_queue not null,
  status           public.job_status not null default 'pending',
  progress         integer not null default 0 check (progress >= 0 and progress <= 100),
  progress_message text,
  model_id         uuid references public.models (id) on delete set null,
  model_ids        uuid[] not null default '{}',
  dataset_id       uuid references public.datasets (id) on delete set null,
  config           jsonb not null default '{}'::jsonb,
  input_payload    jsonb not null default '{}'::jsonb,
  result           jsonb,
  error_message    text,
  total_items      integer not null default 0,
  processed_items  integer not null default 0,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now()
);

create table if not exists public.inference_job_items (
  id              uuid primary key default uuid_generate_v4(),
  job_id          uuid not null references public.inference_jobs (id) on delete cascade,
  dataset_file_id uuid references public.dataset_files (id) on delete set null,
  status          public.job_status not null default 'pending',
  progress        integer not null default 0,
  result          jsonb,
  error_message   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists idx_inference_jobs_project on public.inference_jobs (project_id);
create index if not exists idx_inference_jobs_status on public.inference_jobs (status);
create index if not exists idx_inference_jobs_queue on public.inference_jobs (queue_name, status);
create index if not exists idx_inference_job_items_job on public.inference_job_items (job_id);

drop trigger if exists inference_jobs_updated_at on public.inference_jobs;
create trigger inference_jobs_updated_at
  before update on public.inference_jobs
  for each row execute function public.handle_updated_at();

alter table public.inference_jobs enable row level security;
alter table public.inference_job_items enable row level security;

drop policy if exists "Public inference jobs access" on public.inference_jobs;
create policy "Public inference jobs access" on public.inference_jobs
  for all using (true) with check (true);

drop policy if exists "Public inference job items access" on public.inference_job_items;
create policy "Public inference job items access" on public.inference_job_items
  for all using (true) with check (true);

-- Realtime for job progress
do $$ begin
  alter publication supabase_realtime add table public.inference_jobs;
exception when others then null;
end $$;
