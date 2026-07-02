-- =============================================================================
-- Axiom AI — RESET + FULL SCHEMA (run once in Supabase SQL Editor)
--
-- ⚠️  WARNING: Deletes ALL app data (tables + rows). Storage buckets are kept.
-- Use when you had the OLD schema (dataset_files, inference_jobs, etc.)
-- and need the NEW schema (images, labelling_jobs, …) for the current worker.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Drop OLD + NEW tables (safe order)
-- ---------------------------------------------------------------------------

drop table if exists public.inference_job_items cascade;
drop table if exists public.inference_jobs cascade;
drop table if exists public.dataset_files cascade;
drop table if exists public.model_comparison_results cascade;
drop table if exists public.model_test_runs cascade;
drop table if exists public.export_jobs cascade;
drop table if exists public.review_queues cascade;
drop table if exists public.job_registry cascade;
drop table if exists public.labelling_jobs cascade;
drop table if exists public.annotation_objects cascade;
drop table if exists public.annotations cascade;
drop table if exists public.images cascade;
drop table if exists public.models cascade;
drop table if exists public.datasets cascade;
drop table if exists public.classes cascade;
drop table if exists public.projects cascade;

-- Old enums from legacy migrations (ignore errors if missing)
drop type if exists public.job_type cascade;
drop type if exists public.job_status cascade;
drop type if exists public.job_queue cascade;
drop type if exists public.review_status cascade;
drop type if exists public.model_format cascade;

-- ---------------------------------------------------------------------------
-- 2) Extensions + helpers
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Core tables (matches worker/app/services/supabase_repo.py)
-- ---------------------------------------------------------------------------

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  annotation_type  text not null default 'bounding_box',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.classes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  class_name   text not null,
  class_index  integer not null default 0,
  color        text default '#6366f1',
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_classes_project on public.classes (project_id);
create index idx_classes_project_index on public.classes (project_id, class_index);

create table public.datasets (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  name                 text not null,
  description          text,
  total_images         integer not null default 0,
  total_size_bytes     bigint not null default 0,
  storage_folder_path  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, name)
);

create index idx_datasets_project on public.datasets (project_id);

-- Images (replaces old dataset_files)
create table public.images (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  dataset_id  uuid not null references public.datasets (id) on delete cascade,
  file_name   text not null,
  hf_repo     text not null default 'datasets',
  hf_path     text not null,
  mime_type   text,
  file_size   bigint not null default 0,
  width       integer,
  height      integer,
  status      text not null default 'uploaded',
  queue_type  text not null default 'unassigned',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_images_dataset on public.images (dataset_id);
create index idx_images_project on public.images (project_id);
create index idx_images_queue on public.images (project_id, queue_type);

create table public.models (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  model_name     text not null,
  model_version  text not null default '1.0.0',
  model_type     text not null default 'pytorch',
  hf_repo        text not null default 'models',
  hf_path        text not null,
  class_mapping  jsonb not null default '{}'::jsonb,
  file_size      bigint,
  description    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, model_name)
);

create index idx_models_project on public.models (project_id);

create table public.annotations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  image_id        uuid not null references public.images (id) on delete cascade,
  job_id          uuid,
  status          text not null default 'active',
  source          text not null default 'auto',
  review_status   text,
  reviewed_at     timestamptz,
  auto_labeled_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_annotations_image on public.annotations (image_id);
create index idx_annotations_review on public.annotations (project_id, review_status);

create table public.annotation_objects (
  id             uuid primary key default gen_random_uuid(),
  annotation_id  uuid not null references public.annotations (id) on delete cascade,
  project_id     uuid not null references public.projects (id) on delete cascade,
  image_id       uuid not null references public.images (id) on delete cascade,
  class_id       uuid references public.classes (id) on delete set null,
  class_index    integer not null default 0,
  class_name     text not null default 'unknown',
  x_min          double precision not null,
  y_min          double precision not null,
  x_max          double precision not null,
  y_max          double precision not null,
  confidence     double precision not null default 1.0,
  source         text not null default 'auto',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_annotation_objects_image on public.annotation_objects (image_id);

create table public.labelling_jobs (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  job_type              text not null,
  dataset_id            uuid references public.datasets (id) on delete set null,
  model_id              uuid references public.models (id) on delete set null,
  model_ids             uuid[] not null default '{}',
  confidence_threshold  double precision not null default 0.25,
  iou_threshold         double precision not null default 0.45,
  image_size            integer not null default 640,
  low_label_threshold   integer not null default 1,
  config                jsonb not null default '{}'::jsonb,
  input_payload         jsonb not null default '{}'::jsonb,
  result                jsonb,
  status                text not null default 'queued',
  progress              integer not null default 0,
  progress_message      text,
  total_items           integer not null default 0,
  processed_items       integer not null default 0,
  error_message         text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index idx_labelling_jobs_project on public.labelling_jobs (project_id);
create index idx_labelling_jobs_status on public.labelling_jobs (status);

create table public.job_registry (
  job_id      uuid primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  job_type    text not null,
  created_at  timestamptz not null default now()
);

create table public.review_queues (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  image_id    uuid not null references public.images (id) on delete cascade,
  queue_type  text not null,
  reason      text,
  created_at  timestamptz not null default now()
);

create table public.model_test_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  status      text not null default 'queued',
  payload     jsonb not null default '{}'::jsonb,
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.model_comparison_results (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  test_run_id  uuid references public.model_test_runs (id) on delete cascade,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table public.export_jobs (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  export_format  text not null,
  status         text not null default 'running',
  hf_repo        text,
  hf_path        text,
  error_message  text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- 4) updated_at triggers
-- ---------------------------------------------------------------------------

create trigger projects_updated_at before update on public.projects
  for each row execute function public.handle_updated_at();

create trigger classes_updated_at before update on public.classes
  for each row execute function public.handle_updated_at();

create trigger datasets_updated_at before update on public.datasets
  for each row execute function public.handle_updated_at();

create trigger images_updated_at before update on public.images
  for each row execute function public.handle_updated_at();

create trigger models_updated_at before update on public.models
  for each row execute function public.handle_updated_at();

create trigger annotations_updated_at before update on public.annotations
  for each row execute function public.handle_updated_at();

create trigger annotation_objects_updated_at before update on public.annotation_objects
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 5) RLS — open (no login)
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.classes enable row level security;
alter table public.datasets enable row level security;
alter table public.images enable row level security;
alter table public.models enable row level security;
alter table public.annotations enable row level security;
alter table public.annotation_objects enable row level security;
alter table public.labelling_jobs enable row level security;
alter table public.job_registry enable row level security;
alter table public.review_queues enable row level security;
alter table public.model_test_runs enable row level security;
alter table public.model_comparison_results enable row level security;
alter table public.export_jobs enable row level security;

do $$ declare t text; begin
  foreach t in array array[
    'projects','classes','datasets','images','models','annotations',
    'annotation_objects','labelling_jobs','job_registry','review_queues',
    'model_test_runs','model_comparison_results','export_jobs'
  ] loop
    execute format('drop policy if exists "Public access" on public.%I', t);
    execute format(
      'create policy "Public access" on public.%I for all using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Storage buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('datasets', 'datasets', false, 52428800),
  ('models', 'models', false, 524288000),
  ('exports', 'exports', false, 524288000)
on conflict (id) do nothing;

drop policy if exists "Public datasets storage" on storage.objects;
create policy "Public datasets storage" on storage.objects for all
  using (bucket_id = 'datasets') with check (bucket_id = 'datasets');

drop policy if exists "Public models storage" on storage.objects;
create policy "Public models storage" on storage.objects for all
  using (bucket_id = 'models') with check (bucket_id = 'models');

drop policy if exists "Public exports storage" on storage.objects;
create policy "Public exports storage" on storage.objects for all
  using (bucket_id = 'exports') with check (bucket_id = 'exports');

-- ---------------------------------------------------------------------------
-- 7) Refresh PostgREST schema cache (fixes PGRST205 after DDL)
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';

-- Done. Tables: projects, classes, datasets, images, models, annotations,
-- annotation_objects, labelling_jobs, job_registry, review_queues,
-- model_test_runs, model_comparison_results, export_jobs
