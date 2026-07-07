# Supabase Auth and Project Persistence

DumpDeck uses Supabase Auth as the source of truth for users. Project and draft
rows are user-owned and protected by Row-Level Security.

## Required Redirect URLs

In Supabase Dashboard, open **Authentication → URL Configuration**.

### Local Development

Use this while running the app locally:

```text
Site URL: http://localhost:3000
Redirect URLs:
http://localhost:3000/auth/callback
http://localhost:3000/auth
```

### Netlify Deploy Previews

Add the exact preview URL Netlify gives you:

```text
https://<deploy-preview-or-branch-url>.netlify.app/auth/callback
https://<deploy-preview-or-branch-url>.netlify.app/auth
```

### Production / Custom Domain

When the final domain exists:

```text
Site URL: https://your-domain.com
Redirect URLs:
https://your-domain.com/auth/callback
https://your-domain.com/auth
```

## Email Template URLs

Supabase confirmation, magic-link, and password-reset emails should send users
back to DumpDeck. The app passes these URLs when it calls Supabase Auth:

```text
Confirmation URL: <app-origin>/auth/callback?mode=verified
Magic link URL: <app-origin>/auth/callback?mode=verified
Reset password URL: <app-origin>/auth/callback?mode=reset
```

If you customize Supabase email templates, keep the action link as Supabase's
provided confirmation/recovery link token and make sure the redirect target is
one of the allow-listed `/auth/callback` URLs above.

## Required Tables

Apply all migrations in `supabase/migrations`, especially:

```text
20260707000100_fix_auth_project_persistence.sql
```

That migration creates or repairs:

- `saved_projects`
- `dumpdeck_drafts`
- `saved_project_photos`
- `saved_project_event_groups`
- `saved_project_photo_states`
- `saved_project_captions`

It also enables RLS and adds policies so users can only select, insert, update,
and delete rows where `user_id = auth.uid()`.

## Important

Do not disable RLS. If the app reports that `public.saved_projects` is missing,
the production Supabase database has not had the project persistence migration
applied yet, or the PostgREST schema cache has not refreshed after applying it.
