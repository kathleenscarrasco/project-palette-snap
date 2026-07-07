create extension if not exists pgcrypto with schema public;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.saved_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  selected_preferences jsonb not null default '{}'::jsonb,
  duplicate_decisions jsonb not null default '[]'::jsonb,
  final_order_photo_ids jsonb not null default '[]'::jsonb,
  removed_photo_ids jsonb not null default '[]'::jsonb,
  restored_photo_ids jsonb not null default '[]'::jsonb,
  pinned_cover_photo_id text,
  caption_ideas jsonb not null default '[]'::jsonb,
  active_draft_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_projects
  add column if not exists selected_preferences jsonb not null default '{}'::jsonb,
  add column if not exists duplicate_decisions jsonb not null default '[]'::jsonb,
  add column if not exists final_order_photo_ids jsonb not null default '[]'::jsonb,
  add column if not exists removed_photo_ids jsonb not null default '[]'::jsonb,
  add column if not exists restored_photo_ids jsonb not null default '[]'::jsonb,
  add column if not exists pinned_cover_photo_id text,
  add column if not exists caption_ideas jsonb not null default '[]'::jsonb,
  add column if not exists active_draft_id uuid,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.saved_projects enable row level security;

drop policy if exists "Users can read saved projects" on public.saved_projects;
create policy "Users can read saved projects"
  on public.saved_projects
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert saved projects" on public.saved_projects;
create policy "Users can insert saved projects"
  on public.saved_projects
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update saved projects" on public.saved_projects;
create policy "Users can update saved projects"
  on public.saved_projects
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete saved projects" on public.saved_projects;
create policy "Users can delete saved projects"
  on public.saved_projects
  for delete
  using (auth.uid() = user_id);

drop trigger if exists saved_projects_set_updated_at on public.saved_projects;
create trigger saved_projects_set_updated_at
  before update on public.saved_projects
  for each row execute function public.set_updated_at();

create index if not exists saved_projects_user_updated_idx
  on public.saved_projects (user_id, updated_at desc);

create table if not exists public.saved_project_photos (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.saved_projects(id) on delete cascade,
  original_file_url text,
  preview_file_url text,
  mime_type text,
  original_mime_type text,
  converted_from_heic boolean not null default false,
  conversion_quality double precision,
  width integer,
  height integer,
  file_size bigint,
  fingerprint text,
  status text not null default 'uploaded',
  analysis jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

alter table public.saved_project_photos enable row level security;

drop policy if exists "Users can read project photos" on public.saved_project_photos;
create policy "Users can read project photos"
  on public.saved_project_photos
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert project photos" on public.saved_project_photos;
create policy "Users can insert project photos"
  on public.saved_project_photos
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update project photos" on public.saved_project_photos;
create policy "Users can update project photos"
  on public.saved_project_photos
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete project photos" on public.saved_project_photos;
create policy "Users can delete project photos"
  on public.saved_project_photos
  for delete
  using (auth.uid() = user_id);

drop trigger if exists saved_project_photos_set_updated_at on public.saved_project_photos;
create trigger saved_project_photos_set_updated_at
  before update on public.saved_project_photos
  for each row execute function public.set_updated_at();

create index if not exists saved_project_photos_user_project_idx
  on public.saved_project_photos (user_id, project_id);

create index if not exists saved_project_photos_fingerprint_idx
  on public.saved_project_photos (user_id, fingerprint);

create table if not exists public.saved_project_event_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.saved_projects(id) on delete cascade,
  title text not null,
  description text,
  group_type text not null default 'event',
  photo_ids jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_project_event_groups enable row level security;

drop policy if exists "Users can read event groups" on public.saved_project_event_groups;
create policy "Users can read event groups"
  on public.saved_project_event_groups
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert event groups" on public.saved_project_event_groups;
create policy "Users can insert event groups"
  on public.saved_project_event_groups
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update event groups" on public.saved_project_event_groups;
create policy "Users can update event groups"
  on public.saved_project_event_groups
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete event groups" on public.saved_project_event_groups;
create policy "Users can delete event groups"
  on public.saved_project_event_groups
  for delete
  using (auth.uid() = user_id);

drop trigger if exists saved_project_event_groups_set_updated_at on public.saved_project_event_groups;
create trigger saved_project_event_groups_set_updated_at
  before update on public.saved_project_event_groups
  for each row execute function public.set_updated_at();

create index if not exists saved_project_event_groups_user_project_idx
  on public.saved_project_event_groups (user_id, project_id);

create table if not exists public.saved_project_photo_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.saved_projects(id) on delete cascade,
  photo_id text not null,
  state text not null check (state in ('selected', 'removed', 'restored', 'rejected')),
  reason text,
  rank integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, photo_id, state)
);

alter table public.saved_project_photo_states enable row level security;

drop policy if exists "Users can read photo states" on public.saved_project_photo_states;
create policy "Users can read photo states"
  on public.saved_project_photo_states
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert photo states" on public.saved_project_photo_states;
create policy "Users can insert photo states"
  on public.saved_project_photo_states
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update photo states" on public.saved_project_photo_states;
create policy "Users can update photo states"
  on public.saved_project_photo_states
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete photo states" on public.saved_project_photo_states;
create policy "Users can delete photo states"
  on public.saved_project_photo_states
  for delete
  using (auth.uid() = user_id);

drop trigger if exists saved_project_photo_states_set_updated_at on public.saved_project_photo_states;
create trigger saved_project_photo_states_set_updated_at
  before update on public.saved_project_photo_states
  for each row execute function public.set_updated_at();

create index if not exists saved_project_photo_states_user_project_idx
  on public.saved_project_photo_states (user_id, project_id);

create table if not exists public.saved_project_captions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.saved_projects(id) on delete cascade,
  caption_text text not null,
  category text,
  is_selected boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_project_captions enable row level security;

drop policy if exists "Users can read captions" on public.saved_project_captions;
create policy "Users can read captions"
  on public.saved_project_captions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert captions" on public.saved_project_captions;
create policy "Users can insert captions"
  on public.saved_project_captions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update captions" on public.saved_project_captions;
create policy "Users can update captions"
  on public.saved_project_captions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete captions" on public.saved_project_captions;
create policy "Users can delete captions"
  on public.saved_project_captions
  for delete
  using (auth.uid() = user_id);

drop trigger if exists saved_project_captions_set_updated_at on public.saved_project_captions;
create trigger saved_project_captions_set_updated_at
  before update on public.saved_project_captions
  for each row execute function public.set_updated_at();

create index if not exists saved_project_captions_user_project_idx
  on public.saved_project_captions (user_id, project_id);

create table if not exists public.dumpdeck_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.saved_projects(id) on delete set null,
  ordered_photo_ids jsonb not null default '[]'::jsonb,
  rejected_photo_ids jsonb not null default '[]'::jsonb,
  duplicate_decisions jsonb not null default '[]'::jsonb,
  selected_preferences jsonb not null default '{}'::jsonb,
  scores_reasons jsonb not null default '[]'::jsonb,
  draft_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id)
);

alter table public.dumpdeck_drafts enable row level security;

drop policy if exists "Users can read DumpDeck drafts" on public.dumpdeck_drafts;
create policy "Users can read DumpDeck drafts"
  on public.dumpdeck_drafts
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert DumpDeck drafts" on public.dumpdeck_drafts;
create policy "Users can insert DumpDeck drafts"
  on public.dumpdeck_drafts
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update DumpDeck drafts" on public.dumpdeck_drafts;
create policy "Users can update DumpDeck drafts"
  on public.dumpdeck_drafts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete DumpDeck drafts" on public.dumpdeck_drafts;
create policy "Users can delete DumpDeck drafts"
  on public.dumpdeck_drafts
  for delete
  using (auth.uid() = user_id);

drop trigger if exists dumpdeck_drafts_set_updated_at on public.dumpdeck_drafts;
create trigger dumpdeck_drafts_set_updated_at
  before update on public.dumpdeck_drafts
  for each row execute function public.set_updated_at();

create index if not exists dumpdeck_drafts_user_updated_idx
  on public.dumpdeck_drafts (user_id, updated_at desc);

create index if not exists dumpdeck_drafts_project_idx
  on public.dumpdeck_drafts (project_id);
