alter table public.images
  add column if not exists local_path text,
  add column if not exists storage_status text,
  add column if not exists hf_sync_status text,
  add column if not exists last_error text;
