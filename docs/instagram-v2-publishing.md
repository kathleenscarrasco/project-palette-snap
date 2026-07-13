# FotoFairy Instagram V2 Sharing and Publishing

This document separates the launchable universal Instagram share flow from the future direct Meta API publishing flow.

## Current Root Cause

The old final-screen `Download images` ZIP path fetched each photo's current source URL and wrote that blob directly into the ZIP. That meant the ZIP could contain original formats such as HEIC, HEIF, PNG, WebP, or temporary browser-derived files instead of Instagram-ready JPEGs.

The V2 export path must always render selected photos through a canvas first, then ZIP only numbered JPEG outputs plus `caption.txt`.

## Immediate JPEG Export Architecture

Implemented client-side:

1. Load each final ordered photo from its durable display source.
2. Decode it in the browser.
3. Render it to an Instagram-compatible canvas.
4. Preserve the full image by default with contain-style fitting.
5. Add neutral padding instead of silently cropping.
6. Export as `image/jpeg` at approximately `0.92` quality.
7. Name files `FotoFairy-01.jpg`, `FotoFairy-02.jpg`, and so on.
8. Add `caption.txt`.
9. Create either a native Web Share payload or a ZIP fallback.

Canvas JPEG export strips original EXIF metadata, including GPS/device metadata, because the new JPEG is rendered pixels only rather than the original file bytes.

## Universal Share Flow

`VITE_INSTAGRAM_SHARE_ENABLED=true` controls the universal share/export surface.

The universal flow does not require Instagram login:

1. Save the collection first if needed.
2. Open the Instagram export workflow.
3. Prepare numbered JPEGs in final order.
4. Copy the caption.
5. If `navigator.share` and file sharing are supported, call the native share sheet with JPEG files.
6. If not supported, download a ZIP and show manual posting instructions.

The UI must never claim that a post was published unless Meta returns a successful direct-publish response.

## Direct Publishing Status

Direct publishing is not enabled yet.

Server flag:

```bash
INSTAGRAM_DIRECT_PUBLISH_ENABLED=false
```

Do not expose unfinished OAuth or direct-publish buttons to normal users until production setup is complete.

## Required Meta Configuration

Before direct publishing can be implemented and verified:

1. Create or configure a Meta developer app.
2. Add the current Instagram API product.
3. Configure Instagram Login.
4. Add valid OAuth redirect URIs for local, deploy preview, staging, and production.
5. Configure allowed domains.
6. Add app testers while the Meta app is in development mode.
7. Provide a public privacy policy URL.
8. Provide a public data deletion callback/instructions URL.
9. Request App Review before public use.
10. Store credentials only in server environment variables.

Server-only environment variables:

```bash
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=
INSTAGRAM_DIRECT_PUBLISH_ENABLED=false
```

Never commit or expose `META_APP_SECRET`, access tokens, refresh tokens, or service-role keys.

## Permissions To Verify Before Coding

Meta permission names change over time. Before coding the OAuth exchange, verify the current official Meta documentation for Instagram Login and Content Publishing.

Expected current permission family for Instagram Login direct publishing:

- `instagram_business_basic`
- `instagram_business_content_publish`

If Meta's current docs require different permissions, update this document and the implementation before enabling direct publishing.

## Database Migration Plan

Add user-owned tables with strict RLS:

```sql
create table instagram_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instagram_user_id text not null,
  instagram_username text,
  account_type text,
  encrypted_access_token text not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table instagram_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid,
  instagram_connection_id uuid references instagram_connections(id) on delete set null,
  status text not null,
  photo_count integer not null default 0,
  caption text,
  child_container_ids text[] not null default '{}',
  parent_container_id text,
  published_media_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
```

Policies:

- users select only their own connection/job rows
- users insert rows only where `user_id = auth.uid()`
- users update/delete only their own rows
- raw encrypted token fields should not be returned to the browser; use server routes/RPCs for status views

## Temporary Public Media Strategy

Meta must fetch media from an unauthenticated HTTPS URL during direct publishing. Do not expose original private collection files.

Future direct-publish flow:

1. Convert final photos to JPEG exports.
2. Upload exports to a dedicated temporary publish path or bucket.
3. Use random, unguessable object names.
4. Make only those converted export files temporarily fetchable by Meta.
5. Create child media containers in final order.
6. Create the parent carousel.
7. Publish.
8. Delete temporary exports after success/failure/timeout.
9. Run scheduled cleanup for abandoned jobs.

## Security Risks

- leaking Meta app secret or access tokens
- returning raw tokens to the frontend
- making private user originals public
- temporary publish URLs lasting too long
- duplicate publish jobs from double-clicks
- logging tokens or signed URLs
- losing a saved collection after a publish error

Mitigations:

- all OAuth and publish calls happen server-side
- token encryption at rest
- strict RLS
- idempotent publish jobs
- short-lived temporary media
- server-side technical logs with user-friendly errors

## App Review Requirements

Before public direct publishing:

- Meta app must be production-ready
- requested permissions must pass App Review
- test users and eligible Creator/Business accounts must be verified
- privacy policy URL must be live
- data deletion instructions/callback must be live
- publish and cleanup flows must be tested in production

## Test Plan

Universal export:

- JPEG, PNG, HEIC, HEIF
- portrait, landscape, square, panorama, very tall image
- EXIF-rotated image
- image with GPS metadata
- Web Share file support
- Web Share unsupported
- share cancelled
- ZIP fallback
- caption with line breaks/emojis

Direct publishing, once implemented:

- Creator account
- Business account
- personal account fallback
- expired/revoked token
- missing permission
- app development mode tester
- carousel at and over current Meta limits
- child container failure
- duplicate publish attempt
- refresh during publish
- temporary media cleanup
