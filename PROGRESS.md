# Progress

Living tracker of **what's built** and **what's left**. For the domain language
see `CONTEXT.md`; for the decisions and their rationale see `docs/adr/`.

## Stack (see ADR-0001, 0003, 0006, 0008)

- Single Cloudflare Worker (Hono) serves the React SPA (Workers Static Assets)
  **and** the JSON API on the same origin.
- Vite + `@cloudflare/vite-plugin`, TypeScript, React 19, TanStack Query.
- D1 (SQLite) via Drizzle ORM. UUIDv7 text primary keys.
- Roll-your-own auth: `arctic` (Google OAuth) + `@oslojs/crypto`. Sessions in D1.

## Commands

```
npm run dev               # Vite + Worker dev server at http://localhost:5173
npm run build             # tsc -b && vite build
npm test                  # vitest run (Workers pool, real Miniflare D1)
npm run db:generate       # drizzle-kit: schema.ts -> migrations/*.sql
npm run db:migrate:local  # apply migrations to local D1
npm run db:migrate:remote # apply migrations to remote D1
npm run cf-typegen        # regenerate worker-configuration.d.ts after wrangler.jsonc changes
```

Test tooling is pinned: `@cloudflare/vitest-pool-workers@0.8.71` + `vitest@~3.2`
(see ADR-0007 — do **not** bump to npm `latest`, it's a broken beta).

## Local secrets (auth)

`.dev.vars` (gitignored; template in `.dev.vars.example`) must contain:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5173/api/auth/google/callback
```

GCP setup: APIs & Services → OAuth consent screen (External, Testing mode, add
yourself as a Test user; scopes openid/email/profile need no verification) →
Credentials → OAuth client ID (Web application) → Authorized redirect URI must
byte-match `GOOGLE_REDIRECT_URI`. `localhost` over http is allowed by Google.

## Source layout

```
src/worker/
  index.ts              # Hono app, route mounting, ASSETS fallthrough
  db/{schema,index,id}.ts
  auth/{session,users,google,cookies,middleware,routes}.ts
  repo/                 # the scoped data layer (every fn takes userId first)
    visibility.ts       # THE spine: visibleListPredicate + isFamilyMember
    errors.ts, lists.ts, items.ts, families.ts, invites.ts
    schedules.ts, occurrence-expansion.ts
  api/                  # thin Hono routers over repos (lists, items, families, schedules)
src/client/
  api.ts, hooks.ts, datetime.ts, recurrence.ts
  App.tsx, main.tsx, styles.css
  components/           # Login, Home, Sidebar, FamilySection, ItemsPanel,
                        # SchedulesSection, ScheduleOccurrences, Join
test/                   # visibility, auth, families, schedules (40 tests)
migrations/             # 0000_core_schema, 0001_add_sessions
```

## Implemented

- **Auth**: Google OAuth (PKCE + state), D1 sessions (random token, SHA-256
  hash stored), `__Host-` cookies, `authMiddleware` + `requireUser`, `/api/me`,
  logout, account-linking by verified email (rejects unverified-email-in-use).
  `returnTo` resume (validated same-origin) so `/join/...` survives login.
- **Visibility spine** (ADR-0002): one predicate; invisible == not-found;
  family writes gated by membership. Tested for cross-user/family isolation.
- **Lists**: personal + family-owned, CRUD, list API returns owning `familyName`.
- **Items**: CRUD, toggle complete (optimistic), optional due time
  (UTC instant + IANA tz), edit title/due (set/clear).
- **Families & sharing**: create family, reusable 7-day invite (regenerate
  replaces), join via `/join/:secret`, leave (last member deletes family +
  cascades). Sidebar grouped Personal / per-Family with invite & leave UI.
- **Schedules/Occurrences** (ADR-0004): RRULE via `rrule`, occurrences computed
  per window and merged with persisted rows, complete/skip upserts (and deletes
  the row when state clears). UI: daily/weekly-by-weekday presets + tick/skip.

## Not yet built (backlog, roughly prioritized)

1. **Reminders / Web Push** (ADR future; CONTEXT "Reminder"). Anchor points now
   exist (Item.dueAt, Schedule occurrences). Needs:
   - push subscription storage (new table: user/device endpoint + keys, p256dh/auth)
   - a `reminders` concept attached to an Item or Schedule (offset before due)
   - a scheduled trigger (Cron Trigger or DO alarm) to compute due reminders and
     send Web Push; VAPID keys as secrets
   - frontend: permission prompt + service worker push handler + reminder UI
   - **decisions still open**: per-device vs per-user subscriptions; where the
     scheduler lives (Cron vs DO alarm — DO also enables real-time later).
2. **Email Ingestion** (ADR-0005). Inbound email → Workers AI → suggested
   (pending) Items. Needs: per-List/Family unique inbound address column, Email
   Routing + Email Worker, LLM extraction, pending-item confirm UI. Item already
   has `origin`/`status` columns reserved.
3. **Deploy to production**. `wrangler d1 create remember` → set real
   `database_id` in wrangler.jsonc → `db:migrate:remote` → `wrangler secret put`
   the 3 GOOGLE_* values → add prod redirect URI in GCP → publish consent screen
   → `npm run deploy`.
4. **Real-time updates** (deferred). DO-per-Family fronting WebSockets; would
   also host reminder alarms. D1 schema unaffected.
5. **PWA installability** (CONTEXT: installable shell, online data). Manifest +
   service worker for install; no offline data sync in v1.

## Known gaps / tech debt

- **No API-route tests** — repos + auth are well tested; the Hono routers are
  thin wrappers and untested. The `returnTo`/login-resume flow is only manually
  verified.
- **Occurrence one-off edits**: schema has `override_title`/`override_at`, repo
  only wires complete/skip. No override-title/reschedule yet.
- **Occurrence window**: server defaults to next 60 days; UI shows next 5. No
  past-occurrence view or pagination.
- **Timezone in recurrence**: Schedule stores an IANA tz but expansion uses the
  absolute UTC instant. Fine for v1; true tz-aware recurrence across DST would
  need rrule's tz handling.
- **No member-list UI**: you can see a Family's lists but not who's in it.
- **`.dev.vars` is copied into `dist/` by the vite plugin** (for `vite preview`).
  `dist/` is gitignored so no leak, but never deploy `dist/` contents directly.
- **Repo not under git yet** — initialize before deploying.
```
