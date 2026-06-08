import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { requireUser } from "../auth/middleware.ts";
import {
  listSchedules,
  createSchedule,
  deleteSchedule,
  listOccurrences,
  setOccurrenceState,
} from "../repo/schedules.ts";

type Ctx = { Bindings: Env; Variables: AuthVariables };

function listIdOf(c: { req: { param: (k: string) => string | undefined } }) {
  return c.req.param("listId") ?? "";
}

// Schedules under /api/lists/:listId/schedules.
export const scheduleRoutes = new Hono<Ctx>();
scheduleRoutes.use("*", requireUser);

scheduleRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  return c.json(await listSchedules(db, user.id, listIdOf(c)));
});

// Create a Schedule. Body: { title, rrule, dtstart, timezone }.
scheduleRoutes.post("/", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{
    title?: unknown;
    rrule?: unknown;
    dtstart?: unknown;
    timezone?: unknown;
  }>();

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const rrule = typeof body.rrule === "string" ? body.rrule : "";
  const dtstart = typeof body.dtstart === "string" ? body.dtstart : "";
  const timezone = typeof body.timezone === "string" ? body.timezone : "";
  if (!title || !rrule || !dtstart || !timezone) {
    return c.json(
      { error: "title, rrule, dtstart, timezone are required" },
      400,
    );
  }

  try {
    const schedule = await createSchedule(db, user.id, listIdOf(c), {
      title,
      rrule,
      dtstart,
      timezone,
    });
    if (!schedule) return c.json({ error: "Not found" }, 404);
    return c.json(schedule, 201);
  } catch {
    return c.json({ error: "Invalid recurrence rule" }, 400);
  }
});

// Occurrences are addressed by schedule id (not nested under listId) since the
// schedule already authorizes via its List.
export const occurrenceRoutes = new Hono<Ctx>();
occurrenceRoutes.use("*", requireUser);

// List occurrences in a window. Query: ?from=ISO&to=ISO (defaults to next 60d).
occurrenceRoutes.get("/:scheduleId/occurrences", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const now = Date.now();
  const from = c.req.query("from") ?? new Date(now).toISOString();
  const to =
    c.req.query("to") ??
    new Date(now + 1000 * 60 * 60 * 24 * 60).toISOString();

  const occ = await listOccurrences(
    db,
    user.id,
    c.req.param("scheduleId"),
    from,
    to,
  );
  if (occ === null) return c.json({ error: "Not found" }, 404);
  return c.json(occ);
});

// Set state for one occurrence. Body: { occurrenceAt, completed?, skipped? }.
occurrenceRoutes.post("/:scheduleId/occurrences", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{
    occurrenceAt?: unknown;
    completed?: unknown;
    skipped?: unknown;
  }>();

  const occurrenceAt =
    typeof body.occurrenceAt === "string" ? body.occurrenceAt : "";
  if (!occurrenceAt) {
    return c.json({ error: "occurrenceAt is required" }, 400);
  }

  const state: { completed?: boolean; skipped?: boolean } = {};
  if (typeof body.completed === "boolean") state.completed = body.completed;
  if (typeof body.skipped === "boolean") state.skipped = body.skipped;

  const result = await setOccurrenceState(
    db,
    user.id,
    c.req.param("scheduleId"),
    occurrenceAt,
    state,
  );
  if (result === null) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

scheduleRoutes.delete("/:scheduleId", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const ok = await deleteSchedule(db, user.id, c.req.param("scheduleId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});
