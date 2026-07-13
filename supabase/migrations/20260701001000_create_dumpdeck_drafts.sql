create table if not exists public.saved_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists dumpdeck_drafts_user_updated_idx
  on public.dumpdeck_drafts (user_id, updated_at desc);

create index if not exists dumpdeck_drafts_project_idx
  on public.dumpdeck_drafts (project_id);
