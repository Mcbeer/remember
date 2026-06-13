import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createDb } from "./db/index.ts";
import { authRoutes } from "./auth/routes.ts";
import { listRoutes } from "./api/lists.ts";
import { itemRoutes } from "./api/items.ts";
import { familyRoutes, inviteRoutes } from "./api/families.ts";
import { scheduleRoutes, occurrenceRoutes } from "./api/schedules.ts";
import { reminderRoutes } from "./api/reminders.ts";
import { pushRoutes } from "./api/push.ts";
import { runReminderTick } from "./push/scheduler.ts";
import {
  authMiddleware,
  requireUser,
  type AuthVariables,
} from "./auth/middleware.ts";

// The Hono app is exported for tests (app.request(...)); the Worker's default
// export wraps it with the scheduled() reminder handler below.
export const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Resolve the session for every request; routes opt into requiring it.
app.use("/api/*", authMiddleware);

app.get("/api/health", async (c) => {
  const db = createDb(c.env.DB);
  const probe = await db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
  return c.json({
    status: "ok",
    db: probe?.ok === 1 ? "up" : "down",
    time: new Date().toISOString(),
  });
});

app.route("/api/auth", authRoutes);
app.route("/api/lists", listRoutes);
app.route("/api/lists/:listId/items", itemRoutes);
app.route("/api/lists/:listId/schedules", scheduleRoutes);
app.route("/api/schedules", occurrenceRoutes);
app.route("/api/families", familyRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/reminders", reminderRoutes);
app.route("/api/push", pushRoutes);

// The current User, or 401 if not logged in.
app.get("/api/me", requireUser, (c) => {
  const user = c.get("user")!;
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  });
});

// Anything not matched by the API falls through to the static SPA assets.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// The fetch handler is the Hono app; the scheduled handler is the reminder cron
// (configured as a Cron Trigger in wrangler.jsonc). Every tick finds Reminders
// whose fire moment has arrived and sends Web Push to each recipient's devices.
export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    const db = createDb(env.DB);
    ctx.waitUntil(
      runReminderTick(db, {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      }).then(({ sent, pruned }) => {
        console.log(`reminder tick: sent=${sent} pruned=${pruned}`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
