# Username and password authentication

Visitors choose **New here? Create account**, a username, and a password, then
enter the report workspace immediately. Returning users select **Sign in**.
There is no email, Google, code, SMTP, or email-template setup in this flow.
The existing frontend theme and Supabase session restoration are preserved.

Usernames are case-insensitive, 3–24 ASCII letters/numbers/underscores. Passwords
are 8–128 characters at signup. Supabase Auth hashes/stores passwords and manages
sessions; application tables never store passwords.

Supabase password authentication requires an email or phone identifier. The shared
`shared/username.mjs` maps the normalized username to an internal address under
`users.someones-houston.invalid`. This is an identifier, **not a verified contact
address**. The signup endpoint accepts only username/password and confirms only
this synthetic address through the server-only Auth Admin API. Real-email
confirmation settings are unchanged. User metadata is display-only, never access
control; protected AI requests verify the actual Auth user ID.

`username-signup` verifies a project API key against this project's Auth gateway.
Its gateway JWT check is disabled because first-time visitors have no user token.
A server-only atomic quota permits 50 signup attempts per rolling hour project-wide;
invalid input is rejected before reservation. Native Supabase Auth rate limits
apply to password login. Duplicate usernames never overwrite an existing account.
The signup quota stores only timestamps/random IDs, pruned after a day on an
accepted reservation. The protected `report-flow` JWT check stays enabled.

For this hackathon, no self-service password recovery is available because no
contact email is collected. Existing email-only accounts are not converted or
deleted: create a username account for the new interface. Existing valid sessions
continue to work. Do not put service-role/OpenRouter secrets in browser config.

## Deployment

Apply the username signup quota migration, then deploy `username-signup` with its
handler, `functions/deno.json`, lockfile and `shared/username.mjs`/`.d.mts`, preserving
repository paths. `backend/supabase/config.toml` records function settings.
Deploy the latest frontend with the same Supabase URL and publishable key.
No new Vercel environment variables or email service are required.

Check create account, sign out, case-insensitive sign-in, wrong password, duplicate
username, and authenticated AI extraction/generation. Never log test passwords or
session tokens. See [release instructions](hackathon-release.md).
