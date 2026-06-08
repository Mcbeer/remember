# D1-backed sessions, hashed tokens, and email-based account linking

Implements the roll-your-own auth from ADR-0001 with `arctic` (OAuth2 dance,
Google first) and `@oslojs/crypto`/`encoding` (token hashing). No managed auth
service, no `nodejs_compat` (arctic v3 uses Web Crypto).

**Sessions live in D1** (a `sessions` table), not KV, so logout/revocation is
immediate (strong consistency) and the stack stays single-store. The cookie
holds a random token; the table stores only its **SHA-256 hash** as the primary
key, so a read-only DB leak exposes no usable tokens. Sessions have a 30-day TTL,
slid when within 15 days of expiry. The cookie is `__Host-session`
(HttpOnly, Secure, SameSite=Lax, Path=/). A stateless JWT was rejected because it
cannot be revoked without extra machinery, defeating the reason for choosing D1.

**Account linking:** a login is matched first by (provider, subject). Otherwise,
if the provider asserts the email is **verified** and a User with that email
exists, a new `oauth_identities` row links to that User (one person = one User).
If the email is **unverified and already in use**, the login is **rejected**
(`AuthError`) — never linked (hijack risk) and never duplicated (`users.email`
is UNIQUE). This contradiction between "don't link unverified" and the unique
email constraint was found by a test; rejection is the resolution.
