create extension if not exists vector with schema public;

create table if not exists public.image_metadata (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  pipeline_version text not null,
  analysis jsonb not null,
  image_quality jsonb not null,
  classification jsonb not null,
  scene_analysis jsonb not null,
  face_analysis jsonb not null,
  aesthetic_score jsonb not null,
  aesthetic_score_value double precision not null default 0,
  clip_embedding jsonb not null,
  clip_embedding_stored boolean not null default false,
  duplicate_cluster_id text,
  analysis_object jsonb,
  detected_object_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fingerprint, pipeline_version)
);

alter table public.image_metadata
  add column if not exists image_quality jsonb not null default '{
    "sharpness": 0,
    "motionBlur": 0,
    "exposure": 0,
    "contrast": 0,
    "saturation": 0,
    "noise": 0,
    "overallTechnicalQuality": 0,
    "signals": {
      "brightness": 0,
      "edgeDetail": 0,
      "underexposed": 0,
      "overexposed": 0
    },
    "model": "technical-heuristics-v1"
  }'::jsonb;

alter table public.image_metadata
  add column if not exists scene_analysis jsonb not null default '{
    "primaryScene": "unknown",
    "secondaryScene": "unknown",
    "indoorsOutdoors": "unknown",
    "confidenceScores": {
      "primaryScene": 0,
      "secondaryScene": 0,
      "indoors": 0,
      "outdoors": 0,
      "food": 0,
      "landscape": 0,
      "beach": 0,
      "city": 0,
      "mountains": 0,
      "pets": 0,
      "vehicles": 0,
      "sports": 0
    },
    "labels": {
      "food": false,
      "landscape": false,
      "beach": false,
      "city": false,
      "mountains": false,
      "pets": false,
      "vehicles": false,
      "sports": false
    },
    "model": "unavailable"
  }'::jsonb;

alter table public.image_metadata
  add column if not exists face_analysis jsonb not null default '{
    "numberOfFaces": 0,
    "croppedFaces": 0,
    "faces": [],
    "model": "unavailable"
  }'::jsonb;

alter table public.image_metadata
  add column if not exists aesthetic_score jsonb not null default '{
    "score": 0,
    "confidence": 0,
    "model": "unconfigured",
    "modelVersion": "tfjs-aesthetic-v1",
    "modelAvailable": false
  }'::jsonb;

alter table public.image_metadata
  add column if not exists aesthetic_score_value double precision not null default 0;

alter table public.image_metadata
  add column if not exists clip_embedding jsonb not null default '{
    "dimensions": 0,
    "model": "unconfigured",
    "modelVersion": "tfjs-clip-image-v1",
    "modelAvailable": false,
    "stored": false
  }'::jsonb;

alter table public.image_metadata
  add column if not exists clip_embedding_stored boolean not null default false;

alter table public.image_metadata
  add column if not exists duplicate_cluster_id text;

alter table public.image_metadata
  add column if not exists analysis_object jsonb;

alter table public.image_metadata
  add column if not exists detected_object_count integer not null default 0;

alter table public.image_metadata enable row level security;

create policy "Users can read cached image metadata"
  on public.image_metadata
  for select
  using (auth.uid() = user_id);

create policy "Users can insert cached image metadata"
  on public.image_metadata
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update cached image metadata"
  on public.image_metadata
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists image_metadata_fingerprint_idx
  on public.image_metadata (user_id, fingerprint);

create index if not exists image_metadata_aesthetic_score_idx
  on public.image_metadata (user_id, aesthetic_score_value);

create index if not exists image_metadata_duplicate_cluster_idx
  on public.image_metadata (user_id, duplicate_cluster_id);

create table if not exists public.image_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  pipeline_version text not null,
  object_index integer not null,
  label text not null,
  label_normalized text not null,
  confidence double precision not null default 0,
  box_2d jsonb,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fingerprint, pipeline_version, object_index)
);

alter table public.image_objects enable row level security;

create policy "Users can read cached image objects"
  on public.image_objects
  for select
  using (auth.uid() = user_id);

create policy "Users can insert cached image objects"
  on public.image_objects
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update cached image objects"
  on public.image_objects
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete cached image objects"
  on public.image_objects
  for delete
  using (auth.uid() = user_id);

create index if not exists image_objects_label_idx
  on public.image_objects (user_id, label_normalized);

create index if not exists image_objects_fingerprint_idx
  on public.image_objects (user_id, fingerprint);

create table if not exists public.image_embeddings (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  pipeline_version text not null,
  embedding_model text not null,
  embedding_model_version text not null,
  dimensions integer not null default 512,
  embedding vector(512) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fingerprint, pipeline_version)
);

alter table public.image_embeddings enable row level security;

create policy "Users can read image embeddings"
  on public.image_embeddings
  for select
  using (auth.uid() = user_id);

create policy "Users can insert image embeddings"
  on public.image_embeddings
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update image embeddings"
  on public.image_embeddings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete image embeddings"
  on public.image_embeddings
  for delete
  using (auth.uid() = user_id);

create index if not exists image_embeddings_fingerprint_idx
  on public.image_embeddings (user_id, fingerprint);

create index if not exists image_embeddings_cosine_idx
  on public.image_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists public.image_duplicate_clusters (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  pipeline_version text not null,
  duplicate_cluster_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fingerprint, pipeline_version)
);

alter table public.image_duplicate_clusters enable row level security;

create policy "Users can read duplicate clusters"
  on public.image_duplicate_clusters
  for select
  using (auth.uid() = user_id);

create policy "Users can insert duplicate clusters"
  on public.image_duplicate_clusters
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update duplicate clusters"
  on public.image_duplicate_clusters
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete duplicate clusters"
  on public.image_duplicate_clusters
  for delete
  using (auth.uid() = user_id);

create index if not exists image_duplicate_clusters_cluster_idx
  on public.image_duplicate_clusters (user_id, duplicate_cluster_id);

create table if not exists public.image_rankings (
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  pipeline_version text not null,
  ranking_model text not null,
  ranking_model_version text not null,
  keep_score double precision not null default 0,
  delete_score double precision not null default 0,
  confidence double precision not null default 0,
  explanation text not null default '',
  recommendation text not null check (recommendation in ('keep', 'delete')),
  duplicate_cluster_id text,
  duplicate_cluster_best_photo_id text,
  best_in_duplicate_cluster boolean not null default true,
  duplicate_cluster_rank integer not null default 1,
  overall_rank integer not null default 1,
  overall_score double precision not null default 0,
  ranking jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fingerprint, pipeline_version, ranking_model_version)
);

alter table public.image_rankings enable row level security;

create policy "Users can read image rankings"
  on public.image_rankings
  for select
  using (auth.uid() = user_id);

create policy "Users can insert image rankings"
  on public.image_rankings
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update image rankings"
  on public.image_rankings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete image rankings"
  on public.image_rankings
  for delete
  using (auth.uid() = user_id);

create index if not exists image_rankings_keep_score_idx
  on public.image_rankings (user_id, keep_score);

create index if not exists image_rankings_overall_rank_idx
  on public.image_rankings (user_id, overall_rank);

create index if not exists image_rankings_duplicate_cluster_idx
  on public.image_rankings (user_id, duplicate_cluster_id);

create or replace function public.match_image_embeddings(
  query_embedding vector(512),
  match_count integer default 20,
  min_similarity double precision default 0
)
returns table (
  fingerprint text,
  pipeline_version text,
  similarity double precision
)
language sql
stable
as $$
  select
    image_embeddings.fingerprint,
    image_embeddings.pipeline_version,
    1 - (image_embeddings.embedding <=> query_embedding) as similarity
  from public.image_embeddings
  where image_embeddings.user_id = auth.uid()
    and 1 - (image_embeddings.embedding <=> query_embedding) >= min_similarity
  order by image_embeddings.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_similar_images(
  anchor_fingerprint text,
  match_count integer default 20,
  min_similarity double precision default 0
)
returns table (
  fingerprint text,
  pipeline_version text,
  similarity double precision
)
language sql
stable
as $$
  with anchor as (
    select embedding
    from public.image_embeddings
    where user_id = auth.uid()
      and fingerprint = anchor_fingerprint
    order by updated_at desc
    limit 1
  )
  select
    image_embeddings.fingerprint,
    image_embeddings.pipeline_version,
    1 - (image_embeddings.embedding <=> anchor.embedding) as similarity
  from public.image_embeddings, anchor
  where image_embeddings.user_id = auth.uid()
    and image_embeddings.fingerprint <> anchor_fingerprint
    and 1 - (image_embeddings.embedding <=> anchor.embedding) >= min_similarity
  order by image_embeddings.embedding <=> anchor.embedding
  limit match_count;
$$;
