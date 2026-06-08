import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { requireUser } from "../auth/middleware.ts";
import { AuthorizationError } from "../repo/errors.ts";
import {
  createFamily,
  listFamiliesForUser,
  leaveFamily,
} from "../repo/families.ts";
import { generateInvite, acceptInvite } from "../repo/invites.ts";

type Ctx = { Bindings: Env; Variables: AuthVariables };

export const familyRoutes = new Hono<Ctx>();

familyRoutes.use("*", requireUser);

// The current User's Families.
familyRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  return c.json(await listFamiliesForUser(db, user.id));
});

// Create a Family (caller becomes first Member).
familyRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{ name?: unknown }>();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name is required" }, 400);

  const family = await createFamily(db, user.id, name);
  return c.json(family, 201);
});

// Generate (or regenerate) this Family's invite. Members only.
familyRoutes.post("/:id/invite", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  try {
    const invite = await generateInvite(db, user.id, c.req.param("id"));
    return c.json({ secret: invite.secret, expiresAt: invite.expiresAt }, 201);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return c.json({ error: err.message }, 403);
    }
    throw err;
  }
});

// Leave a Family. Last member out deletes the Family and its Lists/Items.
familyRoutes.post("/:id/leave", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const result = await leaveFamily(db, user.id, c.req.param("id"));
  if (!result.left) return c.json({ error: "Not a member" }, 404);
  return c.json(result);
});

// Invites are accepted by secret, decoupled from the family id the joiner
// doesn't know yet.
export const inviteRoutes = new Hono<Ctx>();
inviteRoutes.use("*", requireUser);

inviteRoutes.post("/:secret/accept", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const result = await acceptInvite(db, user.id, c.req.param("secret"));

  switch (result.status) {
    case "invalid":
      return c.json({ error: "Invalid invite" }, 404);
    case "expired":
      return c.json({ error: "Invite expired" }, 410);
    default:
      return c.json(result);
  }
});
