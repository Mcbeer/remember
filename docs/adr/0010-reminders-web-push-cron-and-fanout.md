# Reminders via Web Push, fired by a Cron Trigger, fanned out to all Members

A **Reminder** is a Web Push fired a configured offset before a due moment
(CONTEXT "Reminder"). It attaches to either an **Item** (its `dueAt`) or a
**Schedule** (its next Occurrence) — exactly one anchor, enforced by a schema
CHECK — and is **shared like its anchor**: any Member can add or remove one on a
shared Item/Schedule, and there is a single Reminder per offset, not one per
Member. This keeps the "shared list" mental model intact (ADR-0002) rather than
giving each Member a private Reminder.

**Fan-out is to all recipients of the anchor's List**: a personal List's owning
User, or **every Member** of the owning Family, each on all their devices. We
chose whole-Family fan-out over creator-only because a reminder on a shared chore
is a shared concern; the cost is potential notification noise, accepted for v1.

**Subscriptions are per-device** (`push_subscriptions`: userId + unique endpoint
+ p256dh/auth), not per-user, because Web Push is inherently per-endpoint — a
phone and a laptop are two endpoints and both should ring. Dead endpoints
(404/410 from the push service) are pruned on send.

**The scheduler is a Cron Trigger** (`* * * * *` → `scheduled()` →
`runReminderTick`), not a Durable Object alarm. Cron keeps the single-Worker
stack (ADR-0003) with no new infra, at the cost of **minute granularity** and the
fact that reminders only fire on the deployed Worker (never under `dev`).
`collectDueReminders` is a pure decision step (unit-tested independently of the
network send); idempotency comes from `reminders.lastSentAt` holding the
due/occurrence instant already fired, with a one-hour catch-up window for missed
ticks. A DO alarm (to-the-second firing, and a home for future real-time updates)
was deferred, not rejected — see PROGRESS backlog.

**Web Push is implemented dependency-free on WebCrypto** (`src/worker/push/`):
the VAPID ES256 JWT (RFC 8292) and the aes128gcm payload encryption (RFC 8291,
ECDH P-256 + HKDF-SHA256 + AES-128-GCM). We avoided the `web-push` npm library so
the whole crypto path stays auditable and runs natively on the Workers runtime
with no Node shims; the cost is owning ~200 lines of spec-faithful crypto, whose
encrypt/decrypt roundtrip is verified against a simulated UA keypair. VAPID keys
are Worker secrets (`VAPID_PUBLIC_KEY`/`PRIVATE_KEY`/`SUBJECT`); the public key
is also the client's `applicationServerKey`, served from `GET /api/push/key`.
