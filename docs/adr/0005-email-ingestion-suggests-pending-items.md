# Email Ingestion suggests pending Items via a unique inbound address

(Future / out of scope for v1 — the architectural boundary is decided now so the
core model reserves room for it.)

Inbound email is handled natively: Cloudflare Email Routing delivers to an Email
Worker, which calls a small on-platform LLM (Workers AI) to extract a title, due
time, and possibly a recurrence, then writes through the same domain logic the
API uses (into D1). Ingestion is just another writer into the existing model — no
schema reshaping required.

Routing & authorisation: each List (or Family) has a **unique secret inbound
address** (e.g. `fam-a8f3@inbox.example.com`). The local-part identifies the
target List and acts as the capability — possession of the address is the
authorisation. Sender-allowlist matching was rejected as brittle (schools send
from varying addresses) and spoofable.

Trust: machine-extracted Items can be wrong (hallucinated titles/dates), so an
Item carries an **origin** (User-created vs Email-ingested) and ingested Items
enter a **pending** state — a Member must confirm or edit before the Item counts
as real. We accept the cost of an origin/pending attribute on Item to avoid
polluting shared Lists with untrusted data.
