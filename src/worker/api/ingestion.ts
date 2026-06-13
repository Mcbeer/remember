import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { requireUser } from "../auth/middleware.ts";
import {
  getInboxAddress,
  generateInboxAddress,
} from "../repo/inbox-addresses.ts";
import {
  listPendingItems,
  confirmPendingItem,
  rejectPendingItem,
} from "../repo/items.ts";

type Ctx = { Bindings: Env; Variables: AuthVariables };

// The domain part of every inbound address. The full address shown to the User
// is `${secret}@${INBOX_DOMAIN}`; only the secret local-part is stored. Override
// per-environment via the INBOX_DOMAIN var (wrangler.jsonc / .dev.vars).
function inboxDomain(env: Env): string {
  return env.INBOX_DOMAIN || "hornskov.dev";
}

function addressOf(env: Env, secret: string): string {
  return `${secret}@${inboxDomain(env)}`;
}

// Email Ingestion endpoints (ADR-0005), all under a visible List:
//   GET    /api/lists/:listId/inbox-address     -> current address (or null)
//   POST   /api/lists/:listId/inbox-address     -> mint/regenerate
//   GET    /api/lists/:listId/pending           -> suggested Items to review
//   POST   /api/lists/:listId/pending/:id/confirm
//   POST   /api/lists/:listId/pending/:id/reject
export const ingestionRoutes = new Hono<Ctx>();

ingestionRoutes.use("*", requireUser);

function listIdOf(c: { req: { param: (k: string) => string | undefined } }) {
  return c.req.param("listId") ?? "";
}

// The List's inbound address, or { address: null } if none minted yet.
ingestionRoutes.get("/:listId/inbox-address", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const row = await getInboxAddress(db, user.id, listIdOf(c));
  // null means either no address minted yet OR the List is not visible; both
  // collapse to { address: null }, which keeps the visibility-hiding convention
  // (an outsider learns nothing) and lets the UI offer "Generate".
  if (row === null) return c.json({ address: null });
  return c.json({ address: addressOf(c.env, row.secret), secret: row.secret });
});

// Mint (or regenerate) the List's inbound address. Regenerating invalidates the
// old one immediately. Any Member of a visible List may do this.
ingestionRoutes.post("/:listId/inbox-address", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const row = await generateInboxAddress(db, user.id, listIdOf(c));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(
    { address: addressOf(c.env, row.secret), secret: row.secret },
    201,
  );
});

// Suggested (pending) Items awaiting review in this List.
ingestionRoutes.get("/:listId/pending", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  return c.json(await listPendingItems(db, user.id, listIdOf(c)));
});

// Confirm a suggestion -> it becomes a real active Item. The body may carry
// edits applied in the same step: { title?, due?: { at, timezone } | null }.
ingestionRoutes.post("/:listId/pending/:itemId/confirm", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const itemId = c.req.param("itemId");

  let edits: { title?: string; due?: { at: string; timezone: string } | null } =
    {};
  try {
    const body = await c.req.json<{
      title?: unknown;
      due?: { at?: unknown; timezone?: unknown } | null;
    }>();
    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) return c.json({ error: "title cannot be empty" }, 400);
      edits.title = title;
    }
    if (body.due !== undefined) {
      if (body.due === null) {
        edits.due = null;
      } else {
        const at = typeof body.due.at === "string" ? body.due.at : "";
        const timezone =
          typeof body.due.timezone === "string" ? body.due.timezone : "";
        if (!at || !timezone) {
          return c.json({ error: "due requires both at and timezone" }, 400);
        }
        edits.due = { at, timezone };
      }
    }
  } catch {
    // No/empty body: confirm with no edits.
    edits = {};
  }

  const item = await confirmPendingItem(db, user.id, itemId, edits);
  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(item);
});

// Reject a suggestion -> discard it. 404 if it is not a visible pending Item.
ingestionRoutes.post("/:listId/pending/:itemId/reject", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const ok = await rejectPendingItem(db, user.id, c.req.param("itemId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});
