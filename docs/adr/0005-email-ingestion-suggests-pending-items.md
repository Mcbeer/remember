# Email Ingestion suggests pending Items via a unique inbound address

(Implemented. The architectural boundary below was decided up front; this records
both the decision and how it shipped.)

Inbound email is handled natively: Cloudflare Email Routing delivers to an Email
Worker, which calls a small on-platform LLM (Workers AI) to extract a title and
due time, then writes through the same domain logic the API uses (into D1).
Ingestion is just another writer into the existing model — no schema reshaping
required.

Routing & authorisation: each **List** has a **unique secret inbound address**
(e.g. `groceries-a8f3@inbox.example.com`). The local-part identifies the target
List and acts as the capability — possession of the address is the authorisation.
Sender-allowlist matching was rejected as brittle (schools send from varying
addresses) and spoofable. We chose **per-List** (not per-Family) addresses: a
List is the write target and matches the List-scoped visibility spine, so no
list-routing logic or "default inbox list" is needed.

Trust: machine-extracted Items can be wrong (hallucinated titles/dates), so an
Item carries an **origin** (User-created vs Email-ingested) and ingested Items
enter a **pending** state — a Member must confirm or edit before the Item counts
as real. We accept the cost of an origin/pending attribute on Item to avoid
polluting shared Lists with untrusted data.

## How it shipped

- **Schema**: `inbox_addresses` (one secret per List, `UNIQUE(list_id)`,
  regenerating replaces the row — mirrors the Invite secret pattern). Items use
  the already-reserved `origin`/`status` columns; ingested Items are
  `origin='ingested'`, `status='pending'`, `created_by=null`.
- **Read split**: `listItems` returns only `status='active'`; pending
  suggestions surface separately via `listPendingItems`, so untrusted data never
  mixes into the real list.
- **Email Worker**: `email()` handler resolves the List from the recipient
  local-part (`resolveListBySecret`, unscoped — the secret *is* the capability),
  parses Subject + plain/HTML body, and calls a swappable `ItemExtractor`
  (`@cf/meta/llama-3.1-8b-instruct`). Output is defensively parsed
  (`parseExtraction`) so a bad model response yields zero suggestions, never a
  500. Unknown addresses are `setReject`-ed.
- **API** (all under a visible List, member-scoped): `GET/POST
  /api/lists/:id/inbox-address`, `GET /api/lists/:id/pending`, `POST
  .../pending/:itemId/confirm` (optional inline edits), `.../reject`.
- **UX**: a mobile-first review banner at the top of a List ("N suggested items
  from email") opens into stacked cards with large, full-width Approve/Reject
  buttons and tap-to-edit-before-approve; a mail icon discloses/mints the List's
  inbound address (copy + regenerate).

## Scope / open follow-ups

- **Items only** (not Schedules): recurrence detection is deferred — pending
  state is defined for Items, not Schedules, and there are no reserved Schedule
  columns for it. Revisit if recurring ingestion becomes common.
- **Timezone**: a resolved due time is attributed to a single default zone
  (`INBOX_DOMAIN`-adjacent config); a fuller build would carry the List's/
  Family's zone.
- **Email Routing setup** (operational, outside the code): point the
  `INBOX_DOMAIN` (or a catch-all) at this Worker's `email()` handler in the
  Cloudflare dashboard; the `AI` binding is in `wrangler.jsonc`.
