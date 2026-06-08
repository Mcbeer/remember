# D1 schema with Drizzle ORM, UUIDv7 keys, and DB-enforced ownership

The relational model lives in D1 with the schema defined in TypeScript via
**Drizzle ORM** (`src/worker/db/schema.ts`). `drizzle-kit generate` diffs the
schema and emits SQL into `migrations/`; migrations are applied with
`wrangler d1 migrations apply`. Drizzle was chosen over hand-written SQL +
prepared statements so that row types flow into the query layer — the
ownership/visibility "spine" (ADR-0002) is the riskiest code, and end-to-end
types catch scoping mistakes. Cost: a mild lock-in to Drizzle and two tools
touching `migrations/` (drizzle-kit generates, wrangler applies).

Primary keys are **UUIDv7** text, generated in app code (`src/worker/db/id.ts`).
Time-ordered, so keys are roughly insertion-ordered (better index locality than
random v4) while remaining unguessable — safe to expose in URLs and reused for
Invite secrets and future inbound-email addresses. `crypto.randomUUID()` only
emits v4, hence the small custom generator.

List ownership is **polymorphic**: `lists` has nullable `owner_user_id` and
`owner_family_id` with a CHECK enforcing exactly one is non-null. This keeps real
foreign keys to both `users` and `families` (DB-enforced integrity) rather than a
`owner_type` discriminator that no FK can reference. Item `created_by` is a
nullable FK with ON DELETE SET NULL so a leaving User's Items survive (ADR-0002);
ownership FKs use ON DELETE CASCADE so deleting a Family removes its Memberships,
Lists, Items, Schedules, and Invite. Timestamps are TEXT ISO-8601 UTC and
booleans are INTEGER 0/1, per SQLite's type system.
