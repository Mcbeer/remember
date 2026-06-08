import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { requireUser } from "../auth/middleware.ts";
import { AuthorizationError } from "../repo/errors.ts";
import {
  listVisibleListsWithOwner,
  getVisibleList,
  createList,
  renameList,
  deleteList,
} from "../repo/lists.ts";

type Ctx = { Bindings: Env; Variables: AuthVariables };

export const listRoutes = new Hono<Ctx>();

listRoutes.use("*", requireUser);

// All Lists visible to the current User, with owning family name for grouping.
listRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  return c.json(await listVisibleListsWithOwner(db, user.id));
});

// Create a List. Body: { name, familyId? }. Omitting familyId = personal.
listRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{ name?: unknown; familyId?: unknown }>();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name is required" }, 400);

  try {
    const list =
      typeof body.familyId === "string"
        ? await createList(db, user.id, {
            name,
            owner: { type: "family", familyId: body.familyId },
          })
        : await createList(db, user.id, { name, owner: { type: "personal" } });
    return c.json(list, 201);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return c.json({ error: err.message }, 403);
    }
    throw err;
  }
});

// A single visible List (404 if not visible/existent).
listRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const list = await getVisibleList(db, user.id, c.req.param("id"));
  if (!list) return c.json({ error: "Not found" }, 404);
  return c.json(list);
});

// Rename a List.
listRoutes.patch("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{ name?: unknown }>();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name is required" }, 400);

  const list = await renameList(db, user.id, c.req.param("id"), name);
  if (!list) return c.json({ error: "Not found" }, 404);
  return c.json(list);
});

// Delete a List (cascades to its Items/Schedules).
listRoutes.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const ok = await deleteList(db, user.id, c.req.param("id"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});
