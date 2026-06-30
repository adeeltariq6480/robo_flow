-- No-auth mode: ONLY run this if tables already exist from ml_schema.sql or full schema.sql
-- If you get "relation public.projects does not exist" → run supabase/ml_schema.sql first

alter table public.projects alter column created_by drop not null;
alter table public.datasets alter column created_by drop not null;
alter table public.models alter column created_by drop not null;

-- Drop owner-only policies
drop policy if exists "Users can view own projects" on public.projects;
drop policy if exists "Users can create projects" on public.projects;
drop policy if exists "Users can update own projects" on public.projects;
drop policy if exists "Users can delete own projects" on public.projects;
drop policy if exists "Owners can view project classes" on public.classes;
drop policy if exists "Owners can manage project classes" on public.classes;
drop policy if exists "Owners can view project datasets" on public.datasets;
drop policy if exists "Owners can manage project datasets" on public.datasets;
drop policy if exists "Owners can view dataset files" on public.dataset_files;
drop policy if exists "Owners can manage dataset files" on public.dataset_files;
drop policy if exists "Owners can view project models" on public.models;
drop policy if exists "Owners can manage project models" on public.models;

-- Public access (no login required)
create policy "Public projects access" on public.projects for all using (true) with check (true);
create policy "Public classes access" on public.classes for all using (true) with check (true);
create policy "Public datasets access" on public.datasets for all using (true) with check (true);
create policy "Public dataset files access" on public.dataset_files for all using (true) with check (true);
create policy "Public models access" on public.models for all using (true) with check (true);

-- Storage public access
drop policy if exists "Owners can upload dataset files" on storage.objects;
drop policy if exists "Owners can view dataset files" on storage.objects;
drop policy if exists "Owners can delete dataset files" on storage.objects;
drop policy if exists "Owners can upload model files" on storage.objects;
drop policy if exists "Owners can view model files" on storage.objects;
drop policy if exists "Owners can delete model files" on storage.objects;

create policy "Public datasets storage" on storage.objects for all
  using (bucket_id = 'datasets') with check (bucket_id = 'datasets');

create policy "Public models storage" on storage.objects for all
  using (bucket_id = 'models') with check (bucket_id = 'models');
