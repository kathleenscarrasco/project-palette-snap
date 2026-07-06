# Mailgun + Supabase Auth Setup

DumpDeck uses Supabase Auth as the source of truth for users. Mailgun should only
be connected to Supabase as the transactional SMTP sender for auth email:
signup confirmation, password reset, magic links, and email changes.

Do not put Mailgun API keys, SMTP passwords, or Supabase service role keys in
frontend code, `.env.example`, or committed files.

## Mailgun

1. Create or open your Mailgun account.
2. Add a sending domain or subdomain, such as `mg.yourdomain.com`.
3. Add the DNS records Mailgun gives you:
   - SPF
   - DKIM
   - DMARC
   - tracking CNAMEs if you enable tracking
4. Wait until Mailgun marks the domain as verified.
5. In Mailgun, copy the SMTP credentials for the verified domain:
   - SMTP host, usually `smtp.mailgun.org`
   - SMTP port, usually `587`
   - SMTP username
   - SMTP password

Mailgun sandbox domains are fine for local testing, but they only send to
authorized recipients. Use a verified custom domain before production launch.

## Supabase

1. Open the Supabase dashboard for the DumpDeck project.
2. Go to Authentication → Providers and keep Email enabled.
3. Go to Authentication → SMTP settings.
4. Enable custom SMTP.
5. Paste the Mailgun SMTP host, port, username, and password.
6. Set a from address that belongs to the verified Mailgun domain.
7. Go to Authentication → URL Configuration.
8. Add local and production redirect URLs, for example:
   - `http://localhost:8081/auth`
   - `http://localhost:5173/auth`
   - `https://your-production-domain.com/auth`
9. Review the Supabase email templates for:
   - Confirm signup
   - Magic link
   - Reset password
   - Change email address

The DumpDeck app sends these redirects:

- Signup confirmation: `/auth?mode=verified`
- Magic link: `/auth?mode=verified`
- Password reset: `/auth?mode=reset`

## Local Development

For real auth testing, use the normal Supabase project settings and run the app
without `VITE_DUMPDECK_DEV_AUTH=true`.

For UI-only local testing without real accounts, you can use:

```bash
VITE_DUMPDECK_DEV_AUTH=true npm run dev
```

That local mode should never be enabled in production.
