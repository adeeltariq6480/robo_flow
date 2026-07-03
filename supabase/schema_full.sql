-- =============================================================================
-- Axiom AI / Robo Flow — Full Supabase schema (no auth)
-- Run this in Supabase Dashboard → SQL Editor (one shot).
-- Replaces Firebase Firestore + Hugging Face file storage.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
-- Projects
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  annotation_type  text not null default 'bounding_box',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Classes
-- ---------------------------------------------------------------------------

create table if not exists public.classes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  class_name   text not null,
  class_index  integer not null default 0,
  color        text default '#6366f1',
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_classes_project on public.classes (project_id);
create index if not exists idx_classes_project_index on public.classes (project_id, class_index);

-- ---------------------------------------------------------------------------
-- Datasets
-- ---------------------------------------------------------------------------

create table if not exists public.datasets (
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

create index if not exists idx_datasets_project on public.datasets (project_id);

-- ---------------------------------------------------------------------------
-- Images (dataset files)
-- ---------------------------------------------------------------------------

create table if not exists public.images (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  dataset_id      uuid not null references public.datasets (id) on delete cascade,
  file_name       text not null,
  hf_repo         text not null default 'datasets',
  hf_path         text not null,
  local_path      text,
  storage_status  text,
  hf_sync_status  text,
  mime_type       text,
  file_size       bigint not null default 0,
  width           integer,
  height          integer,
  status          text not null default 'uploaded',
  queue_type      text not null default 'unassigned',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_images_dataset on public.images (dataset_id);
create index if not exists idx_images_project on public.images (project_id);
create index if not exists idx_images_queue on public.images (project_id, queue_type);
create unique index if not exists idx_images_unique_dataset_hf_path
  on public.images (project_id, dataset_id, hf_path);

-- ---------------------------------------------------------------------------
-- Models
-- ---------------------------------------------------------------------------

create table if not exists public.models (
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

create index if not exists idx_models_project on public.models (project_id);

-- ---------------------------------------------------------------------------
-- Annotations
-- ---------------------------------------------------------------------------

create table if not exists public.annotations (
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

create index if not exists idx_annotations_image on public.annotations (image_id);
create index if not exists idx_annotations_review on public.annotations (project_id, review_status);

-- ---------------------------------------------------------------------------
-- Annotation objects (bounding boxes)
-- ---------------------------------------------------------------------------

create table if not exists public.annotation_objects (
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

create index if not exists idx_annotation_objects_image on public.annotation_objects (image_id);

-- ---------------------------------------------------------------------------
-- Labelling / inference jobs
-- ---------------------------------------------------------------------------

create table if not exists public.labelling_jobs (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  job_type              text not null,
  dataset_id            uuid references public.datasets (id) on delete set null,
  model_id              uuid references public.models (id) on delete set null,
  model_ids             uuid[] not null default '{}',
  confidence_threshold    double precision not null default 0.25,
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

create index if not exists idx_labelling_jobs_project on public.labelling_jobs (project_id);
create index if not exists idx_labelling_jobs_status on public.labelling_jobs (status);

create table if not exists public.job_registry (
  job_id      uuid primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  job_type    text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Review queues
-- ---------------------------------------------------------------------------

create table if not exists public.review_queues (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  image_id    uuid not null references public.images (id) on delete cascade,
  queue_type  text not null,
  reason      text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Model test runs & comparison
-- ---------------------------------------------------------------------------

create table if not exists public.model_test_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  status      text not null default 'queued',
  payload     jsonb not null default '{}'::jsonb,
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.model_comparison_results (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  test_run_id  uuid references public.model_test_runs (id) on delete cascade,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Export jobs
-- ---------------------------------------------------------------------------

create table if not exists public.export_jobs (
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
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
  for each row execute function public.handle_updated_at();

drop trigger if exists classes_updated_at on public.classes;
create trigger classes_updated_at before update on public.classes
  for each row execute function public.handle_updated_at();

drop trigger if exists datasets_updated_at on public.datasets;
create trigger datasets_updated_at before update on public.datasets
  for each row execute function public.handle_updated_at();

drop trigger if exists images_updated_at on public.images;
create trigger images_updated_at before update on public.images
  for each row execute function public.handle_updated_at();

drop trigger if exists models_updated_at on public.models;
create trigger models_updated_at before update on public.models
  for each row execute function public.handle_updated_at();

drop trigger if exists annotations_updated_at on public.annotations;
create trigger annotations_updated_at before update on public.annotations
  for each row execute function public.handle_updated_at();

drop trigger if exists annotation_objects_updated_at on public.annotation_objects;
create trigger annotation_objects_updated_at before update on public.annotation_objects
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (open — no login)
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
-- Storage buckets (datasets, models, exports)
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
