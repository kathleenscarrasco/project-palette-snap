# FotoFairy

## Gemini image analysis

FotoFairy runs Gemini image-understanding requests from the server only. Do not add
`VITE_GEMINI_API_KEY`; any `VITE_` variable is exposed to the browser.

To configure Gemini locally:

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Create or copy an API key.
3. Create `.env.local` in the project root.
4. Add:

```bash
GEMINI_API_KEY=your_google_ai_studio_api_key_here
GEMINI_MODEL=gemini-2.5-flash
DUMPDECK_ANALYSIS_CONCURRENCY=3
DUMPDECK_MAX_GEMINI_PHOTOS=70
```

`GEMINI_MODEL` is optional. If it is omitted, the server uses `gemini-2.5-flash`.
`DUMPDECK_ANALYSIS_CONCURRENCY` is optional and defaults to `3`; use it to control
how many photo-analysis workers run at once for large uploads.
`DUMPDECK_MAX_GEMINI_PHOTOS` is optional and defaults to `70`; FotoFairy quick-scans
all uploads locally, then sends only selected candidates to Gemini for deeper
semantic refinement.

For deployment, set `GEMINI_API_KEY` as a server-side secret/environment variable
in the hosting platform. Never commit real API keys.

## Auth email

Supabase Auth owns signup, login, magic links, and password reset. Mailgun should
be configured only as Supabase's custom SMTP sender in the Supabase dashboard.
See [docs/mailgun-supabase-auth.md](docs/mailgun-supabase-auth.md) for the setup
checklist. Never commit Mailgun API keys or SMTP passwords.
