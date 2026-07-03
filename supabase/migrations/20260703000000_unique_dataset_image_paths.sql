-- Prevent duplicate image rows when an upload finalize request is retried.

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id, dataset_id, hf_path
      order by created_at asc, id asc
    ) as rn
  from public.images
)
delete from public.images
where id in (select id from ranked where rn > 1);

create unique index if not exists idx_images_unique_dataset_hf_path
  on public.images (project_id, dataset_id, hf_path);
