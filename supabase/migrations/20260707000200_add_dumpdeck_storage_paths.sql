insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dumpdeck-photos',
  'dumpdeck-photos',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/gif'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.saved_project_photos
  add column if not exists storage_bucket text not null default 'dumpdeck-photos',
  add column if not exists original_storage_path text,
  add column if not exists preview_storage_path text,
  add column if not exists file_name text,
  add column if not exists uploaded_at timestamptz not null default now();

create index if not exists saved_project_photos_storage_path_idx
  on public.saved_project_photos (user_id, project_id, preview_storage_path);

drop policy if exists "Users can upload own DumpDeck photos" on storage.objects;
create policy "Users can upload own DumpDeck photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'dumpdeck-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can view own DumpDeck photos" on storage.objects;
create policy "Users can view own DumpDeck photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'dumpdeck-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own DumpDeck photos" on storage.objects;
create policy "Users can update own DumpDeck photos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'dumpdeck-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'dumpdeck-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own DumpDeck photos" on storage.objects;
create policy "Users can delete own DumpDeck photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'dumpdeck-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
