# Email-code sign-in

The frontend uses the existing Supabase project `hknzivrgihnqzvsafkkr`. One login
screen handles new and returning users. There is no password or username field.
Accounts and email addresses belong in Supabase Auth's private `auth` schema;
no duplicate public users table or schema migration is needed for this flow.
User verification and token issuance are handled by Supabase Auth. Do not grant
browser roles access to `auth.users` or put an admin key in Vite configuration.

## Hosted setup

For this hackathon the built-in Supabase email service is intentionally retained.
Only project-team email addresses can receive its test emails. The frontend also
supports its default magic links, which return to the configured production Site
URL; a link-only default template does not support typing a code. Do not disable
email confirmation or add visitors as project administrators to work around the
mail restriction. The custom SMTP/template steps below enable code-only login
and delivery to non-team users when ready.

These are dashboard changes, not settings applied by deploying the frontend.
Preserve unrelated project settings and existing redirect URLs. Do not push the
entire local `backend/supabase/config.toml` to production to activate this feature.

1. In Authentication → Sign In / Providers, keep new-user signups allowed and
   Email enabled. Keep email confirmation required. The app sends
   `signInWithOtp({ email, options: { shouldCreateUser: true } })` and verifies
   codes using `verifyOtp({ email, token, type: 'email' })`.
2. In Authentication → Email Templates, use
   [`auth/email-code.html`](auth/email-code.html) for both **Magic Link** and
   **Confirm signup**, with subject `Your Someone's Houston sign-in code`.
   Both templates must contain `{{ .Token }}` so new and existing accounts receive
   a code they can enter in the app. Do not leave a link-only template active.
   Retain the project's code expiry and rate limits; the frontend accepts 6–10
   digits and enforces a 60-second resend cooldown. Server limits remain authoritative.
3. Configure a production SMTP provider and verified sender domain in Supabase.
   Store SMTP credentials only in the provider/Supabase settings. Supabase's
   built-in email service is for testing and restricts delivery; it does not
   support general public registration reliably. Verify sender-domain DNS and
   delivery to an inbox outside the Supabase project team before launch.
## Development and verification

Use the existing ignored `frontend/report-web/.env.local` with the public project
URL and publishable key. From the repository root:

```sh
npm --prefix frontend/report-web ci
npm --prefix frontend/report-web test
npm --prefix frontend/report-web run build
npm --prefix frontend/report-web exec -- playwright install chromium
npm --prefix frontend/report-web run test:e2e
npm --prefix backend run test:frontend
npm --prefix frontend/report-web run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

The browser checks cover desktop/mobile email verification, invalid codes,
new-user eligibility, cooldowns, rate limits, mail failures, restored/expired
sessions, and report-state isolation on logout. They mock Auth responses; they do **not** certify hosted
provider settings or actual email delivery. The API preflight reads live public
neighborhood data and does not create users.

After hosted setup, use accounts you control to verify:

- A new email receives a numeric code; it cannot open the workspace before
  verification. A wrong or expired code is rejected. The correct code opens it.
- The verified user appears in Dashboard → Authentication → Users. Signing out
  and returning with the same email restores the same account.
- Reload restores the session. Logout clears the report, and the next account
  cannot see the previous account's in-session report.
- A verified account can generate a report from live Supabase neighborhood data.

Status inspected on 2026-09-19: email and new-user signups were enabled. Browser roles had no direct SELECT privilege on `auth.users`;
anonymous INSERT and authenticated UPDATE were also denied. Hosted custom SMTP
was disabled and the dashboard required custom SMTP to edit default templates.
Complete SMTP setup and real-provider verification before treating public
onboarding as launch-ready. No production frontend deployment is performed by
these commands.

References: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[production SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
