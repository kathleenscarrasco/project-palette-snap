# FotoFairy Production Readiness

This checklist verifies the current FotoFairy persistence stack before a launch or staging handoff.

## Required migrations

Apply every file in `supabase/migrations` in timestamp order:

1. `20260701000000_create_image_metadata.sql`
   - Image metadata cache, object cache, rankings, embeddings, duplicate clusters, and related RLS.
2. `20260701001000_create_dumpdeck_drafts.sql`
   - `saved_projects` and `dumpdeck_drafts` with user-owned RLS.
3. `20260702013000_add_image_source_metadata.sql`
   - Source image metadata needed for normalized previews and HEIC/HEIF handling.
4. `20260707000100_fix_auth_project_persistence.sql`
   - Expanded project tables for photos, event groups, states, captions, final order, preferences, and updated RLS.
5. `20260707000200_add_dumpdeck_storage_paths.sql`
   - Private `dumpdeck-photos` Storage bucket, storage path columns, and Storage RLS policies.

## Automated check

Run the readiness script with a real confirmed test user:

```bash
FOTOFAIRY_READINESS_EMAIL="tester@example.com" \
FOTOFAIRY_READINESS_PASSWORD="test-password" \
npm run check:supabase
```

The script uses the same public anon client path as the app. It checks:

- test-user sign-in
- `dumpdeck_drafts` can be queried through RLS
- `saved_projects` can be queried through RLS
- `saved_project_photos` includes the storage path columns
- the private `dumpdeck-photos` bucket accepts an upload under the signed-in user's folder
- signed URLs can be generated
- test objects can be deleted

If credentials are omitted, the script prints the manual checklist without touching production data.

## Manual checks

Complete these in Supabase before public launch:

- Authentication URL Configuration:
  - Site URL points to the production domain.
  - Redirect URLs include the production domain, Netlify preview URL pattern, and local dev URL.
  - `/auth/callback` is allowed for signup, magic link, and confirmation flows.
  - `/auth/callback?mode=reset` or the app's reset callback URL is allowed for password recovery.
- Storage:
  - `dumpdeck-photos` is private, not public.
  - Storage object policies require `auth.uid()` to match the first folder in the object path.
  - A signed-in user can upload, sign, read, update, and delete only their own objects.
- Database:
  - RLS is enabled on all user-owned tables.
  - `auth.uid() = user_id` policies exist for select, insert, update, and delete.
  - Autosaves update the same `dumpdeck_drafts` row for a project instead of creating duplicate drafts.
- App smoke test:
  - Sign up and confirm email.
  - Upload JPG, PNG, HEIC/HEIF, screenshots, near duplicates, portraits, and scenery.
  - Save a collection.
  - Refresh, sign out, sign back in, and reopen the collection.
  - Confirm photo URLs are fresh signed URLs and no gray placeholders appear.
  - Delete a collection and confirm the card disappears without a full-page reload.

## Failure handling expectations

User-facing copy should stay generic:

- "We couldn't save your collection right now. Please try again in a moment."
- "Some photos could not be restored. Try refreshing or reopen the collection."

Developer logs should keep the technical details:

- missing table or column
- failed storage path
- signed URL generation failure
- RLS denial
- partial upload or draft save failure

Do not expose service-role keys, SMTP credentials, Mailgun API keys, or `GEMINI_API_KEY` in frontend code.
