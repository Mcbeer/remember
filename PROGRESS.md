# Progress

Living tracker of **what's built** and **what's left**. For the domain language
see `CONTEXT.md`; for the decisions and their rationale see `docs/adr/`.

## Stack (see ADR-0001, 0003, 0006, 0008)

- Single Cloudflare Worker (Hono) serves the React SPA (Workers Static Assets)
  **and** the JSON API on the same origin.
- Vite + `@cloudflare/vite-plugin`, TypeScript, React 19, TanStack Query.
- D1 (SQLite) via Drizzle ORM. UUIDv7 text primary keys.
- Roll-your-own auth: `arctic` (Google OAuth) + `@oslojs/crypto`. Sessions in D1.

## Production (LIVE)

- **URL**: https://remember.hornskov.dev (custom domain on the `hornskov.dev`
  Cloudflare zone; DNS + TLS auto-provisioned via the `routes` custom-domain
  binding in `wrangler.jsonc`).
- **D1**: database `remember` (id `92f094d4-…`), region **WEUR**. Migrations
  applied with `db:migrate:remote`. All 13 tables present (incl.
  `push_subscriptions`, `reminders`, `inbox_addresses`).
- **Secrets** (6, set via `wrangler secret bulk`): `GOOGLE_CLIENT_ID/SECRET`,
  `GOOGLE_REDIRECT_URI` (= `https://remember.hornskov.dev/api/auth/google/callback`),
  `VAPID_PUBLIC_KEY/PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:nicolai.h.n@gmail.com`).
- **Cron trigger** `* * * * *` is attached (reminder scheduler). Note:
  Cloudflare refuses to attach cron triggers until the account has a
  **workers.dev subdomain** — open Workers & Pages in the dashboard once to
  create it (this blocked the first deploy with API error 10063).
- **Google OAuth** stays in **Testing mode**: only emails added under OAuth
  consent screen → Test users can log in. Add each family member there.
- **Verified working end-to-end** (2026-06): Google login, push subscribe, and a
  reminder firing to **both** of a User's devices (`reminder tick: sent=2`),
  confirming per-device subscriptions + whole-Family fan-out (ADR-0010).
- **Redeploy**: `npm run deploy`. Schema changes also need `db:migrate:remote`.

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
VAPID_PUBLIC_KEY=...      # base64url uncompressed P-256 point (also client appServerKey)
VAPID_PRIVATE_KEY=...     # base64url PKCS8 private key
VAPID_SUBJECT=mailto:...  # contact URI sent in the VAPID JWT
```

### VAPID keys (Web Push)

A P-256 keypair authenticates us to push services (RFC 8292). Generate once with
Node's WebCrypto and keep the private key secret:

```
node --input-type=module -e '
const b64u=(u8)=>Buffer.from(u8).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const kp=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
console.log("VAPID_PUBLIC_KEY="+b64u(new Uint8Array(await crypto.subtle.exportKey("raw",kp.publicKey))));
console.log("VAPID_PRIVATE_KEY="+b64u(new Uint8Array(await crypto.subtle.exportKey("pkcs8",kp.privateKey))));
'
```

A dev keypair already lives in `.dev.vars`. In production set all three with
`wrangler secret put VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
The client fetches the public key from `GET /api/push/key`.

GCP setup: APIs & Services → OAuth consent screen (External, Testing mode, add
yourself as a Test user; scopes openid/email/profile need no verification) →
Credentials → OAuth client ID (Web application) → Authorized redirect URI must
byte-match `GOOGLE_REDIRECT_URI`. `localhost` over http is allowed by Google.

## Source layout

```
src/worker/
  index.ts              # Hono app (named export `app`) + default { fetch, scheduled }
  db/{schema,index,id}.ts
  auth/{session,users,google,cookies,middleware,routes}.ts
  repo/                 # the scoped data layer (every fn takes userId first)
    visibility.ts       # THE spine: visibleListPredicate + isFamilyMember
    errors.ts, lists.ts, items.ts, families.ts, invites.ts
    schedules.ts, occurrence-expansion.ts
    reminders.ts, push-subscriptions.ts, inbox-addresses.ts
  push/                 # Web Push: web-push.ts (VAPID+aes128gcm), base64url.ts,
                        # scheduler.ts (collectDueReminders + runReminderTick)
  ingestion/            # Email Ingestion: extract.ts (Workers AI ItemExtractor +
                        # parseExtraction), email.ts (parse + route + ingestEmail)
  api/                  # thin Hono routers over repos (lists, items, families,
                        # schedules, reminders, push, ingestion)
src/client/
  api.ts, hooks.ts, datetime.ts, recurrence.ts, push.ts
  App.tsx, main.tsx, styles.css
  components/           # Login, Home, Sidebar, FamilySection, ItemsPanel,
                        # Reminders, PushPrompt, Join, PendingReview
public/                 # sw.js (push + notificationclick), manifest.webmanifest,
                        # icon-192/512.png, badge-96.png
test/                   # visibility, auth, families, schedules, api, reminders,
                        # web-push, ingestion (123 tests across 8 files)
migrations/             # 0000_core_schema, 0001_add_sessions, 0002 (push+reminders),
                        # 0003 (inbox_addresses)
docs/adr/               # 0001–0010 (0010 = reminders/web-push)
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
  Member-list: a roster toggle per Family (`GET /api/families/:id/members`,
  member-gated → 403 for outsiders) shows each Member's name/avatar inline.
  Invite UI is a toggle: first open mints + copies one link, reopening reuses
  it, and a "Regenerate" button mints a fresh secret on demand (not on every
  click).
- **Schedules/Occurrences** (ADR-0004): RRULE via `rrule`, occurrences computed
  per window and merged with persisted rows, complete/skip upserts (and deletes
  the row when state clears). UI: a single add-entry form with a "repeats"
  toggle (revealing daily/weekly-by-weekday + time) creates a Schedule rather
  than an Item; recurring entries render **inline** in the one list showing only
  their **next** Occurrence (tick = complete that Occurrence, skip, edit, or
  delete the Schedule). One-off edits: a single Occurrence can be retitled
  (`overrideTitle`) or rescheduled (`overrideAt`) without changing the rule —
  the row's identity stays its canonical rule instant; `overrideAt` is the
  moved-to time. Clearing every flag/override deletes the row (computed-only).
  The model keeps Item and Schedule distinct (ADR-0004) — only the UI is
  unified. The standalone `SchedulesSection`/`ScheduleOccurrences` components
  were removed in the redesign (ADR-0009).
- **UI / design** (ADR-0009): Tailwind v4 (`@tailwindcss/vite`, CSS-first) +
  selectively-added shadcn components (`src/client/components/ui/`: Button,
  Input, Checkbox, Dialog, Sheet, Label) + `lib/utils.ts`. Dark-first tokens
  (dark slate in `:root`, no toggle, light deferred). Responsive: sidebar
  collapses to a Sheet drawer on mobile. Due dates set via a calendar-icon
  button that opens the native picker (`showPicker()`), no manual typing.
- **Reminders / Web Push** (CONTEXT "Reminder"). A **Reminder** is shared like
  the thing it attaches to: any Member can add one (offset before due) to an
  **Item** (its `dueAt`) or a **Schedule** (its next Occurrence); exactly one
  anchor (schema CHECK). When it fires, recipients are the List's owning **User**
  or **all Members** of the owning **Family**, pushed on every device.
  - **Subscriptions** are per-device (`push_subscriptions`: user + endpoint +
    p256dh/auth; unique endpoint upserts). Registered on "Enable" via the
    `PushPrompt` banner; pruned automatically on 404/410 from the push service.
  - **Scheduler** is a Cron Trigger (`* * * * *` → `scheduled()` →
    `runReminderTick`). `collectDueReminders` is the pure decision step (fully
    unit-tested); it fires once per due moment via `reminders.lastSentAt` (= the
    dueAt/occurrence instant), with a 1h catch-up window for missed ticks.
  - **Web Push** is dependency-free WebCrypto in `src/worker/push/web-push.ts`:
    VAPID ES256 JWT (RFC 8292) + aes128gcm payload encryption (RFC 8291). The
    encrypt/decrypt roundtrip was verified against a simulated UA keypair.
  - **Client**: `public/sw.js` shows the notification + focuses/opens the app on
    tap; `src/client/push.ts` does permission + subscribe; bell buttons on each
    Item/Schedule row open a reminder dialog (preset offsets).
  - **Icons/manifest**: `public/{icon-192,icon-512,badge-96}.png` (bell, themed
    dark-slate/emerald) + `public/manifest.webmanifest`, linked from
    `index.html`. The notification uses `icon-192` + `badge-96`.
  - **Decision record**: ADR-0010 captures the Cron-vs-DO scheduler, all-Members
    fan-out, per-device subscriptions, and the dependency-free WebCrypto push.
  - **Open follow-ups**: tz-aware Schedule recurrence still uses the absolute UTC
    instant (see tech debt); no per-Member mute of a shared Reminder.
- **Email Ingestion** (ADR-0005). Inbound email → Workers AI → suggested
  (pending) Items, confirmed by a Member before they count.
  - **Inbound address**: per-List secret (`inbox_addresses`, one per List,
    `UNIQUE(list_id)`; regenerate replaces — mirrors the Invite pattern). The
    full address is `${secret}@${INBOX_DOMAIN}`; possession IS the authorisation.
  - **Email Worker**: `email()` in `index.ts` resolves the List by the recipient
    local-part (`resolveListBySecret`, unscoped), parses Subject + body, and runs
    a swappable `ItemExtractor` (`@cf/meta/llama-3.1-8b-instruct`). `parseExtraction`
    defensively pulls the JSON array out of any prose/fences and drops malformed
    entries, so a bad model reply yields zero suggestions, not a 500. Unknown
    addresses are `setReject`-ed.
  - **Pending split**: ingested Items are `origin='ingested'`/`status='pending'`/
    `created_by=null`; `listItems` returns only active rows, `listPendingItems`
    the review queue. Confirm promotes to active (with optional inline edits);
    reject deletes the pending row. All member-scoped via the visibility spine.
  - **API**: `GET/POST /api/lists/:id/inbox-address`, `GET /api/lists/:id/pending`,
    `POST .../pending/:itemId/{confirm,reject}`.
  - **UX (mobile-first)**: a "N suggested items from email" banner at the top of
    a List opens into stacked cards — large full-width Approve/Reject buttons,
    tap-to-edit-before-approve; a mail-icon popover discloses/mints the List's
    inbound address (copy + regenerate). `PendingReview.tsx`.
  - **Bindings/config**: `AI` binding + `INBOX_DOMAIN` var in `wrangler.jsonc`.
    Operational TODO (dashboard): point Email Routing for `INBOX_DOMAIN` (or a
    catch-all) at this Worker's `email()` handler.
  - **Scope**: Items only (no recurrence/Schedule ingestion yet — see ADR-0005).

## Not yet built (backlog, roughly prioritized)

1. **Real-time updates** (deferred). DO-per-Family fronting WebSockets; could
   also host reminder alarms for to-the-second firing (vs the current
   minute-granularity Cron). D1 schema unaffected.
2. **PWA installability** (CONTEXT: installable shell, online data). The
   `manifest.webmanifest`, icons, and a registered `public/sw.js` are now in
   place, so the install criteria are largely met; remaining work is verifying
   the install prompt across browsers (notably iOS, which needs install before
   Web Push works) and any maskable-icon polish. No offline data sync in v1. A
   light theme is also deferred — when added, give it a `.light` block + wire
   `prefers-color-scheme`/a toggle (ADR-0009).

## Known gaps / tech debt

- **API-route tests**: the routers are now covered end-to-end (auth gating,
  status codes, visibility/membership) in `test/api.test.ts` by driving
  `app.request(..., env)` with a real session cookie — families/invites/members,
  lists, items, schedules (list/create/delete + occurrence one-off edits), plus
  reminders (add/list/validation/visibility) and push (key/subscribe/auth).
  `test/reminders.test.ts` covers the reminders repo and `collectDueReminders`
  (Item + Schedule firing, no-double-send, Family fan-out). `test/web-push.test.ts`
  runs the aes128gcm encryption roundtrip on **workerd** (same engine as prod).
  Still untested in CI: the `returnTo`/login-resume flow, the OAuth callback leg,
  and the `runReminderTick` fetch leg (verified live in prod instead —
  `reminder tick: sent=2` to two devices).
- **WebCrypto types lie about ECDH** (caught in prod, 2026-06): the generated
  `worker-configuration.d.ts` types the ECDH `deriveBits` param as `$public`, but
  the workerd runtime requires the standard `public` — using `$public` throws
  `Missing field "public" in "derivedKeyParams"` at send time. `web-push.ts` uses
  `public` with a cast; `test/web-push.test.ts` guards the regression. Lesson:
  trust the runtime over the local types, and test crypto on workerd not Node.
- **Occurrence window**: server defaults to next 60 days; UI shows only the
  next 1 (per recurring entry). No past-occurrence view or pagination.
- **Timezone in recurrence**: Schedule stores an IANA tz but expansion uses the
  absolute UTC instant. Fine for v1; true tz-aware recurrence across DST would
  need rrule's tz handling.
- **`.dev.vars` is copied into `dist/` by the vite plugin** (for `vite preview`).
  `dist/` is gitignored so no leak, but never deploy `dist/` contents directly.
- **Git**: under version control on `main`, pushed to public remote
  `git@github.com:Mcbeer/remember.git`. Repo is public — keep secrets out
  (`.dev.vars` is gitignored, and is also copied into `dist/` — never commit
  `dist/`).
