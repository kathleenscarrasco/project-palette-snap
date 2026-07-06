alter table public.image_metadata
  add column if not exists original_file_url text,
  add column if not exists preview_file_url text,
  add column if not exists mime_type text,
  add column if not exists original_mime_type text,
  add column if not exists converted_from_heic boolean not null default false,
  add column if not exists conversion_quality double precision,
  add column if not exists conversion_decoder text,
  add column if not exists original_byte_size bigint,
  add column if not exists preview_byte_size bigint;

create index if not exists image_metadata_source_mime_idx
  on public.image_metadata (user_id, mime_type);

create index if not exists image_metadata_converted_heic_idx
  on public.image_metadata (user_id, converted_from_heic);
