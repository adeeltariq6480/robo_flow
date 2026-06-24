-- =============================================================================
-- Robo Flow — Supabase schema
-- Robotics workflow automation platform
-- =============================================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =============================================================================
-- Enums
-- =============================================================================

create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.robot_status as enum ('online', 'offline', 'busy', 'error', 'maintenance');
create type public.flow_status as enum ('draft', 'active', 'archived');
create type public.run_status as enum ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled');
create type public.trigger_type as enum ('manual', 'schedule', 'webhook', 'robot_event');
create type public.log_level as enum ('debug', 'info', 'warn', 'error');

-- =============================================================================
-- Profiles (extends auth.users)
-- =============================================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'User profile data linked to Supabase Auth.';

-- =============================================================================
-- Organizations
-- =============================================================================

create table public.organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.organization_members (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            public.org_role not null default 'member',
  invited_at      timestamptz not null default now(),
  joined_at       timestamptz,

  unique (organization_id, user_id)
);

create index idx_org_members_user on public.organization_members (user_id);
create index idx_org_members_org on public.organization_members (organization_id);

-- =============================================================================
-- Robots
-- =============================================================================

create table public.robots (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  description     text,
  model           text,
  serial_number   text,
  status          public.robot_status not null default 'offline',
  capabilities    jsonb not null default '[]'::jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  last_seen_at    timestamptz,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, serial_number)
);

create index idx_robots_org on public.robots (organization_id);
create index idx_robots_status on public.robots (status);

-- =============================================================================
-- Flows & versions
-- =============================================================================

create table public.flows (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  description     text,
  status          public.flow_status not null default 'draft',
  tags            text[] not null default '{}',
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.flow_versions (
  id              uuid primary key default uuid_generate_v4(),
  flow_id         uuid not null references public.flows (id) on delete cascade,
  version         integer not null,
  graph           jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  changelog       text,
  is_published    boolean not null default false,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),

  unique (flow_id, version)
);

create index idx_flows_org on public.flows (organization_id);
create index idx_flow_versions_flow on public.flow_versions (flow_id);

-- =============================================================================
-- Triggers
-- =============================================================================

create table public.triggers (
  id              uuid primary key default uuid_generate_v4(),
  flow_id         uuid not null references public.flows (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type            public.trigger_type not null,
  name            text not null,
  config          jsonb not null default '{}'::jsonb,
  is_enabled      boolean not null default true,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_triggers_flow on public.triggers (flow_id);
create index idx_triggers_org on public.triggers (organization_id);

-- =============================================================================
-- Flow runs & logs
-- =============================================================================

create table public.flow_runs (
  id                uuid primary key default uuid_generate_v4(),
  flow_id           uuid not null references public.flows (id) on delete cascade,
  flow_version_id   uuid not null references public.flow_versions (id) on delete restrict,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  robot_id          uuid references public.robots (id) on delete set null,
  trigger_id        uuid references public.triggers (id) on delete set null,
  status            public.run_status not null default 'pending',
  input             jsonb not null default '{}'::jsonb,
  output            jsonb,
  error_message     text,
  started_at        timestamptz,
  completed_at      timestamptz,
  triggered_by      uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create table public.flow_run_logs (
  id          uuid primary key default uuid_generate_v4(),
  run_id      uuid not null references public.flow_runs (id) on delete cascade,
  node_id     text,
  level       public.log_level not null default 'info',
  message     text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_flow_runs_flow on public.flow_runs (flow_id);
create index idx_flow_runs_org on public.flow_runs (organization_id);
create index idx_flow_runs_status on public.flow_runs (status);
create index idx_flow_run_logs_run on public.flow_run_logs (run_id);

-- =============================================================================
-- Credentials (integration secrets — store vault references, not raw secrets)
-- =============================================================================

create table public.credentials (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  provider        text not null,
  vault_secret_id text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, name)
);

create index idx_credentials_org on public.credentials (organization_id);

-- =============================================================================
-- Flow templates (reusable starting points)
-- =============================================================================

create table public.flow_templates (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  description text,
  category    text,
  graph       jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  is_public   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- =============================================================================
-- Helper functions
-- =============================================================================

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org_id uuid, allowed_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and role = any (allowed_roles)
  );
$$;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

-- =============================================================================
-- Triggers
-- =============================================================================

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

create trigger robots_updated_at
  before update on public.robots
  for each row execute function public.handle_updated_at();

create trigger flows_updated_at
  before update on public.flows
  for each row execute function public.handle_updated_at();

create trigger triggers_updated_at
  before update on public.triggers
  for each row execute function public.handle_updated_at();

create trigger credentials_updated_at
  before update on public.credentials
  for each row execute function public.handle_updated_at();

create trigger flow_templates_updated_at
  before update on public.flow_templates
  for each row execute function public.handle_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.robots enable row level security;
alter table public.flows enable row level security;
alter table public.flow_versions enable row level security;
alter table public.triggers enable row level security;
alter table public.flow_runs enable row level security;
alter table public.flow_run_logs enable row level security;
alter table public.credentials enable row level security;
alter table public.flow_templates enable row level security;

-- Profiles
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Organizations
create policy "Members can view their organizations"
  on public.organizations for select
  using (public.is_org_member(id));

create policy "Authenticated users can create organizations"
  on public.organizations for insert
  with check (auth.uid() = created_by);

create policy "Admins can update organizations"
  on public.organizations for update
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

create policy "Owners can delete organizations"
  on public.organizations for delete
  using (public.has_org_role(id, array['owner']::public.org_role[]));

-- Organization members
create policy "Members can view org membership"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

create policy "Admins can manage org membership"
  on public.organization_members for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Robots
create policy "Members can view org robots"
  on public.robots for select
  using (public.is_org_member(organization_id));

create policy "Members can create robots"
  on public.robots for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.org_role[])
    and auth.uid() = created_by
  );

create policy "Members can update robots"
  on public.robots for update
  using (public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.org_role[]));

create policy "Admins can delete robots"
  on public.robots for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Flows
create policy "Members can view org flows"
  on public.flows for select
  using (public.is_org_member(organization_id));

create policy "Members can create flows"
  on public.flows for insert
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.org_role[])
    and auth.uid() = created_by
  );

create policy "Members can update flows"
  on public.flows for update
  using (public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.org_role[]));

create policy "Admins can delete flows"
  on public.flows for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Flow versions
create policy "Members can view flow versions"
  on public.flow_versions for select
  using (
    exists (
      select 1 from public.flows f
      where f.id = flow_id and public.is_org_member(f.organization_id)
    )
  );

create policy "Members can create flow versions"
  on public.flow_versions for insert
  with check (
    exists (
      select 1 from public.flows f
      where f.id = flow_id
        and public.has_org_role(f.organization_id, array['owner', 'admin', 'member']::public.org_role[])
    )
    and auth.uid() = created_by
  );

-- Triggers
create policy "Members can view org triggers"
  on public.triggers for select
  using (public.is_org_member(organization_id));

create policy "Members can manage triggers"
  on public.triggers for all
  using (public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.org_role[]));

-- Flow runs
create policy "Members can view org runs"
  on public.flow_runs for select
  using (public.is_org_member(organization_id));

create policy "Members can create runs"
  on public.flow_runs for insert
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.org_role[]));

create policy "Members can update runs"
  on public.flow_runs for update
  using (public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.org_role[]));

-- Flow run logs
create policy "Members can view run logs"
  on public.flow_run_logs for select
  using (
    exists (
      select 1 from public.flow_runs r
      where r.id = run_id and public.is_org_member(r.organization_id)
    )
  );

create policy "Members can insert run logs"
  on public.flow_run_logs for insert
  with check (
    exists (
      select 1 from public.flow_runs r
      where r.id = run_id
        and public.has_org_role(r.organization_id, array['owner', 'admin', 'member']::public.org_role[])
    )
  );

-- Credentials
create policy "Members can view org credentials"
  on public.credentials for select
  using (public.is_org_member(organization_id));

create policy "Admins can manage credentials"
  on public.credentials for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Flow templates (public read, admin write via service role)
create policy "Anyone authenticated can view public templates"
  on public.flow_templates for select
  using (is_public = true and auth.role() = 'authenticated');

-- =============================================================================
-- Realtime (optional — enable for live run status)
-- =============================================================================

alter publication supabase_realtime add table public.flow_runs;
alter publication supabase_realtime add table public.flow_run_logs;

-- =============================================================================
-- ML Projects (vision / training workspace)
-- =============================================================================

create type public.model_format as enum ('onnx', 'pytorch', 'tensorflow', 'tflite', 'other');

create table public.projects (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  description text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.classes (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  color       text not null default '#3b82f6',
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (project_id, name)
);

create table public.datasets (
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

create table public.dataset_files (
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

create table public.models (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  description text,
  file_path   text not null,
  file_size   bigint not null default 0,
  format      public.model_format not null default 'other',
  version     text not null default '1.0.0',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (project_id, name)
);

create index idx_projects_created_by on public.projects (created_by);
create index idx_classes_project on public.classes (project_id);
create index idx_datasets_project on public.datasets (project_id);
create index idx_dataset_files_dataset on public.dataset_files (dataset_id);
create index idx_models_project on public.models (project_id);

-- =============================================================================
-- ML helper functions
-- =============================================================================

create or replace function public.is_project_owner(project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects
    where id = project_id and created_by = auth.uid()
  );
$$;

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.handle_updated_at();

create trigger classes_updated_at
  before update on public.classes
  for each row execute function public.handle_updated_at();

create trigger datasets_updated_at
  before update on public.datasets
  for each row execute function public.handle_updated_at();

create trigger models_updated_at
  before update on public.models
  for each row execute function public.handle_updated_at();

-- =============================================================================
-- ML Row Level Security
-- =============================================================================

alter table public.projects enable row level security;
alter table public.classes enable row level security;
alter table public.datasets enable row level security;
alter table public.dataset_files enable row level security;
alter table public.models enable row level security;

create policy "Public projects access"
  on public.projects for all
  using (true) with check (true);

create policy "Public classes access"
  on public.classes for all
  using (true) with check (true);

create policy "Public datasets access"
  on public.datasets for all
  using (true) with check (true);

create policy "Public dataset files access"
  on public.dataset_files for all
  using (true) with check (true);

create policy "Public models access"
  on public.models for all
  using (true) with check (true);

-- =============================================================================
-- Storage buckets
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('datasets', 'datasets', false, 52428800),
  ('models', 'models', false, 524288000)
on conflict (id) do nothing;

create or replace function public.storage_project_id(object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$;

create policy "Public datasets storage"
  on storage.objects for all
  using (bucket_id = 'datasets') with check (bucket_id = 'datasets');

create policy "Public models storage"
  on storage.objects for all
  using (bucket_id = 'models') with check (bucket_id = 'models');
