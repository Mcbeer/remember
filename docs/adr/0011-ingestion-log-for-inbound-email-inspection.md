# An ephemeral Ingestion Log lets a Member inspect inbound emails

(Proposed / backlog — not yet built. Records the design so it's ready to pick up.)

Email Ingestion (ADR-0005) is intentionally opaque: an inbound email is scanned
by Workers AI and only the *suggested Items* surface; the email itself is read
once and discarded. This is fine when extraction works, but leaves two gaps:

1. **Setup friction.** Auto-forwarding from a source like Gmail first sends a
   *confirmation code* to the forwarding address. That code is not an actionable
   task, so the AI returns "no action" and nothing surfaces — the User can never
   read the code to complete setup. (The current workaround is to forward through
   a real inbox or add a temporary `forward` routing rule, then switch back.)
2. **No sanity check.** When the AI extracts nothing (or the wrong thing) from a
   real school email, the User has no way to see what arrived and why nothing was
   created — they just see an empty review queue.

**Decision: keep a short-lived, per-List Ingestion Log of inbound emails.** Each
received email is recorded with its parsed subject, sender, plain-text body, and
the extraction outcome (how many Items were suggested, or "no action"). A new
"Recent emails" view on the List lets any Member read the message even when the
AI created nothing — so the Gmail confirmation code is visible, and "why did
nothing get added?" is answerable. It doubles as an audit trail of what the
machine saw.

**Ephemeral by design (~24h TTL).** These are forwarded personal emails; we store
the minimum and keep it briefly. The existing reminder Cron Trigger (`* * * * *`,
ADR-0010) also sweeps Ingestion Log rows past their TTL, so no new infra and no
indefinite store of personal mail. The log is a transient inspection aid, not a
mailbox.

**Parsed text only — no raw MIME, no attachments.** Storing subject + sender +
plain-text body (the same reduced shape the extractor already consumes,
`toIncomingEmail`) is enough for both the confirmation-code and sanity-check use
cases, and keeps rows small enough for D1 without reaching for R2. Full raw MIME
(in D1 or R2) was considered and deferred: more fidelity than these use cases
need, at higher storage and privacy cost.

**Shared like the List.** The log lives under a List and is visible to exactly
the List's recipients (the owning User, or all Members of the owning Family) via
the visibility spine (ADR-0002) — the same audience that already sees the
suggested Items. Members forwarding school mail into a shared Family List accept
that other Members can read those emails for the retention window; this matches
the existing "shared list" model and is called out here as a conscious choice.

## Sketch (when built)

- **Schema**: `ingestion_log` (id, listId FK cascade, sender, subject, bodyText,
  extractedCount, status `ingested|nothing_extracted`, receivedAt, expiresAt).
- **Repo**: write one row inside `ingestEmail` after extraction; a
  visibility-scoped `listIngestionLog(userId, listId)`; a `pruneExpired(now)` the
  cron calls alongside `runReminderTick`.
- **API**: `GET /api/lists/:listId/ingestion-log` (member-scoped).
- **UI**: a "Recent emails" disclosure near the inbox-address control — each
  entry shows sender/subject/snippet and the extraction outcome; tap to read the
  full body. Empty after the TTL.
