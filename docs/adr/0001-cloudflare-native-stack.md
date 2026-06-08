# Cloudflare-native stack: Workers + D1, no managed auth, no Zero Trust

The app is hosted entirely on Cloudflare. The relational domain (Users, Lists,
Families, Memberships, Items) lives in **D1** (serverless SQLite), accessed from
**Workers**.

We do **not** use Cloudflare Access / Zero Trust: it is gated on a user
whitelist, which is wrong for a consumer app open to mass signup. Cloudflare has
no general-purpose end-user OAuth *identity provider* (the Workers OAuth Provider
library makes our Worker a provider for other apps, which is not what we need).

We therefore **roll our own OAuth client on Workers** (e.g. Better Auth / Lucia +
arctic), brokering Google/GitHub logins and minting our own sessions. This keeps
identity on-platform with no extra auth vendor, at the cost of owning the OAuth
handshake, session lifecycle, and account-linking ourselves.

External Postgres (Neon/Supabase via Hyperdrive) and managed auth (Clerk/WorkOS)
were rejected to stay fully Cloudflare-hosted with no third-party data vendor.
