# FotoFairy Deployment

FotoFairy is a TanStack Start app built with Vite and Nitro. It is not a plain
static Vite SPA. The deployment must preserve the Nitro server layer because
Gemini image-analysis requests run server-side.

## Netlify Staging

Use the repository `netlify.toml` as the source of truth.

- Build command: `npm run build`
- Publish directory: `dist`
- Runtime: Netlify Functions
- Server route: generated Nitro `server` function on `/*`

The app previously failed because Netlify was configured to publish
`dist/client`, but this project does not generate that directory. With the
Netlify preset, Nitro generates public assets in `dist` and the server handler
in `.netlify/functions-internal/server/server.mjs`.

## Build Verification

Run locally:

```bash
npm run build
```

Expected generated output:

```text
dist/
  assets/
  _headers
  _redirects
  favicon.svg

.netlify/
  functions-internal/
    nitro.json
    server/
      server.mjs
      main.mjs
```

`dist/client` should not exist and should not be used.

To run the production artifact locally after building:

```bash
npm run preview
```

The preview command serves `dist` assets and routes requests through the
generated Netlify Function handler, matching staging more closely than Vite's
generic preview server for this TanStack Start/Nitro setup.

## Required Netlify Environment Variables

Add these in Netlify: Site configuration → Environment variables.

### Required

```bash
GEMINI_API_KEY=your_google_ai_studio_key
```

### Recommended

```bash
GEMINI_MODEL=gemini-2.5-flash
DUMPDECK_ANALYSIS_CONCURRENCY=3
DUMPDECK_MAX_GEMINI_PHOTOS=70
```

`GEMINI_MODEL` defaults to `gemini-2.5-flash` when omitted.

### Optional public model URLs

Only set these if you host custom browser-side model files:

```bash
VITE_CLIP_IMAGE_MODEL_URL=https://...
VITE_AESTHETIC_MODEL_URL=https://...
```

These are public by design because every `VITE_` variable is bundled into the
browser.

## Variables That Should Not Be Added

Do not add these to Netlify for the frontend:

```bash
VITE_GEMINI_API_KEY
VITE_MAILGUN_API_KEY
VITE_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SERVICE_ROLE_KEY
MAILGUN_API_KEY
SMTP_PASSWORD
VITE_DUMPDECK_DEV_AUTH
```

Gemini must stay server-only through `GEMINI_API_KEY`.

Supabase Auth email should be configured in the Supabase dashboard using Mailgun
SMTP credentials. Do not put Mailgun API keys or SMTP passwords in this repo or
browser-exposed environment variables.

The current Supabase URL and publishable key are browser-safe and live in
`src/integrations/supabase/client.ts`. Do not use a service role key in browser
code.

## Supabase Auth Redirect URLs

For staging, add the Netlify staging URL in Supabase:

- Authentication → URL Configuration → Site URL
- Authentication → URL Configuration → Redirect URLs

Include:

```text
https://your-staging-site.netlify.app/auth
```

The app uses:

- `/auth?mode=verified`
- `/auth?mode=reset`

## Netlify Deployment Process

1. Connect the GitHub repository to a Netlify site.
2. Use the repo `netlify.toml`; remove any dashboard override that points to
   `dist/client`.
3. Add the required environment variables.
4. Deploy the staging branch.
5. Confirm the deploy log says the publish directory is `dist`.
6. Confirm Netlify detects the generated server function.
7. Visit these URLs directly in a fresh tab:
   - `/`
   - `/auth`
   - `/projects`
   - `/app`
8. Confirm refreshes do not 404.
9. Confirm Gemini endpoints return a helpful configured/missing-key response
   instead of exposing secrets.

## Production Deployment

Production should use the same build settings as staging:

- Build command: `npm run build`
- Publish directory: `dist`
- Nitro preset: `netlify`

Production should use production values for:

- `GEMINI_API_KEY`
- Supabase Auth URL configuration
- Supabase Mailgun SMTP settings

Use branch deploys or deploy previews for staging. Promote only a tested commit
to the production branch.

## Troubleshooting

### Netlify says `dist/client` does not exist

The site still has an old dashboard publish-directory override. Use the repo
`netlify.toml` or update the dashboard setting to `dist`.

### Refreshing `/projects` or `/app` returns 404

Confirm the generated Netlify function is deployed and mapped to `/*`.
This app is SSR-capable; do not replace the server function with a static
`/index.html` fallback unless you intentionally remove server-side routes.

### Gemini works locally but not on Netlify

Confirm `GEMINI_API_KEY` is set in Netlify and is not named
`VITE_GEMINI_API_KEY`.

### Supabase auth emails do not send

Mailgun SMTP is configured in Supabase, not Netlify. Check the Supabase Auth
SMTP settings and redirect URLs.
