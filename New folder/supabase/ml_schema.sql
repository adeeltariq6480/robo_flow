-- =============================================================================
-- Robo Flow — ML tables only (run this FIRST in Supabase SQL Editor)
-- Use when projects/classes/datasets/models tables do not exist yet.
-- No login required — public RLS on all tables.
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Enum
do $$ begin
  create type public.model_format as enum ('onnx', 'pytorch', 'tensorflow', 'tflite', 'other');
exception when duplicate_object then null;
end $$;

-- Updated-at helper
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists public.projects (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  description text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.classes (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  color       text not null default '#3b82f6',
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.datasets (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  name              text not null,
  description       text,
  file_count        integer not null default 0,
  total_size_bytes  bigint not null default 0,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (project_id, name)
);

create table if not exists public.dataset_files (
  id          uuid primary key default uuid_generate_v4(),
  dataset_id  uuid not null references public.datasets (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  class_id    uuid references public.classes (id) on delete set null,
  file_name   text not null,
  file_path   text not null,
  file_size   bigint not null default 0,
  mime_type   text,
  created_at  timestamptz not null default now()
);

create table if not exists public.models (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  description text,
  file_path   text not null,
  file_size   bigint not null default 0,
  format      public.model_format not null default 'other',
  version     text not null default '1.0.0',
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists idx_projects_created_by on public.projects (created_by);
create index if not exists idx_classes_project on public.classes (project_id);
create index if not exists idx_datasets_project on public.datasets (project_id);
create index if not exists idx_dataset_files_dataset on public.dataset_files (dataset_id);
create index if not exists idx_models_project on public.models (project_id);

-- Triggers
drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.handle_updated_at();

drop trigger if exists classes_updated_at on public.classes;
create trigger classes_updated_at
  before update on public.classes
  for each row execute function public.handle_updated_at();

drop trigger if exists datasets_updated_at on public.datasets;
create trigger datasets_updated_at
  before update on public.datasets
  for each row execute function public.handle_updated_at();

drop trigger if exists models_updated_at on public.models;
create trigger models_updated_at
  before update on public.models
  for each row execute function public.handle_updated_at();

-- =============================================================================
-- Row Level Security (public — no login)
-- =============================================================================

alter table public.projects enable row level security;
alter table public.classes enable row level security;
alter table public.datasets enable row level security;
alter table public.dataset_files enable row level security;
alter table public.models enable row level security;

drop policy if exists "Public projects access" on public.projects;
create policy "Public projects access" on public.projects for all using (true) with check (true);

drop policy if exists "Public classes access" on public.classes;
create policy "Public classes access" on public.classes for all using (true) with check (true);

drop policy if exists "Public datasets access" on public.datasets;
create policy "Public datasets access" on public.datasets for all using (true) with check (true);

drop policy if exists "Public dataset files access" on public.dataset_files;
create policy "Public dataset files access" on public.dataset_files for all using (true) with check (true);

drop policy if exists "Public models access" on public.models;
create policy "Public models access" on public.models for all using (true) with check (true);

-- =============================================================================
-- Storage buckets
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('datasets', 'datasets', false, 52428800),
  ('models', 'models', false, 524288000)
on conflict (id) do nothing;

drop policy if exists "Public datasets storage" on storage.objects;
create policy "Public datasets storage" on storage.objects for all
  using (bucket_id = 'datasets') with check (bucket_id = 'datasets');

drop policy if exists "Public models storage" on storage.objects;
create policy "Public models storage" on storage.objects for all
  using (bucket_id = 'models') with check (bucket_id = 'models');
