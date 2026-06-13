import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { requireUser } from "../auth/middleware.ts";
import { deleteReminder } from "../repo/reminders.ts";

type Ctx = { Bindings: Env; Variables: AuthVariables };

// Reminders are created/listed under their anchor (an Item or a Schedule, see
// api/items.ts and api/schedules.ts). Deletion is by reminder id since the id is
// enough to authorize through the anchor's List visibility.
export const reminderRoutes = new Hono<Ctx>();
reminderRoutes.use("*", requireUser);

reminderRoutes.delete("/:reminderId", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const ok = await deleteReminder(db, user.id, c.req.param("reminderId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});
