import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { requireUser } from "../auth/middleware.ts";
import {
  listItems,
  createItem,
  setItemCompleted,
  updateItem,
  deleteItem,
} from "../repo/items.ts";

type Ctx = { Bindings: Env; Variables: AuthVariables };

// Items are addressed under their List: /api/lists/:listId/items[/:itemId].
export const itemRoutes = new Hono<Ctx>();

itemRoutes.use("*", requireUser);

// listId comes from the parent mount path /api/lists/:listId/items.
function listIdOf(c: { req: { param: (k: string) => string | undefined } }) {
  return c.req.param("listId") ?? "";
}

// Items in a visible List.
itemRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  return c.json(await listItems(db, user.id, listIdOf(c)));
});

// Add an Item to a visible List. Body: { title, due?: { at, timezone } }.
itemRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{
    title?: unknown;
    due?: { at?: unknown; timezone?: unknown };
  }>();

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return c.json({ error: "title is required" }, 400);

  let due: { at: string; timezone: string } | undefined;
  if (body.due) {
    const at = typeof body.due.at === "string" ? body.due.at : "";
    const timezone =
      typeof body.due.timezone === "string" ? body.due.timezone : "";
    if (!at || !timezone) {
      return c.json({ error: "due requires both at and timezone" }, 400);
    }
    due = { at, timezone };
  }

  const item = await createItem(db, user.id, listIdOf(c), {
    title,
    due,
  });
  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(item, 201);
});

// Edit an Item. Body may include any of:
//   completed: boolean        -> toggle done
//   title: string             -> rename
//   due: { at, timezone }|null -> set or clear (null) the due time
itemRoutes.patch("/:itemId", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const itemId = c.req.param("itemId");
  const body = await c.req.json<{
    completed?: unknown;
    title?: unknown;
    due?: { at?: unknown; timezone?: unknown } | null;
  }>();

  // Completion toggle is handled on its own (optimistic path on the client).
  if (typeof body.completed === "boolean") {
    const item = await setItemCompleted(db, user.id, itemId, body.completed);
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json(item);
  }

  const patch: { title?: string; due?: { at: string; timezone: string } | null } =
    {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return c.json({ error: "title cannot be empty" }, 400);
    patch.title = title;
  }

  if (body.due !== undefined) {
    if (body.due === null) {
      patch.due = null;
    } else {
      const at = typeof body.due.at === "string" ? body.due.at : "";
      const timezone =
        typeof body.due.timezone === "string" ? body.due.timezone : "";
      if (!at || !timezone) {
        return c.json({ error: "due requires both at and timezone" }, 400);
      }
      patch.due = { at, timezone };
    }
  }

  if (patch.title === undefined && patch.due === undefined) {
    return c.json({ error: "nothing to update" }, 400);
  }

  const item = await updateItem(db, user.id, itemId, patch);
  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(item);
});

// Delete an Item.
itemRoutes.delete("/:itemId", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const ok = await deleteItem(db, user.id, c.req.param("itemId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});
