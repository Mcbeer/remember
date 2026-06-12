import { and, eq, gte, lte } from "drizzle-orm";
import { schedules, occurrences } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";
import { getVisibleList } from "./lists.ts";
import { expandOccurrences, isValidRRule } from "./occurrence-expansion.ts";

export type Schedule = typeof schedules.$inferSelect;
export type OccurrenceRow = typeof occurrences.$inferSelect;

// A computed Occurrence: the instant plus any persisted state. completed/skipped
// default false; title falls back to the Schedule's title unless overridden.
// `occurrenceAt` is always the canonical instant from the rule (its identity for
// addressing); `overrideAt` is the moved-to instant for a rescheduled
// Occurrence, or null when it sits on schedule.
export type ComputedOccurrence = {
  scheduleId: string;
  occurrenceAt: string;
  title: string;
  completed: boolean;
  skipped: boolean;
  overrideAt: string | null;
};

// Schedules belong to a List and inherit its visibility (ADR-0002/0004). Every
// function is scoped by the caller's access to the owning List.

/** Schedules in a visible List, or empty if the List is not visible. */
export async function listSchedules(
  db: Db,
  userId: string,
  listId: string,
): Promise<Schedule[]> {
  const list = await getVisibleList(db, userId, listId);
  if (!list) return [];
  return db.select().from(schedules).where(eq(schedules.listId, listId)).all();
}

export type CreateScheduleInput = {
  title: string;
  rrule: string;
  dtstart: string; // ISO-8601 UTC anchor instant
  timezone: string; // IANA tz the rule is expressed in
};

/**
 * Create a Schedule in a visible List. Returns null if the List is not visible,
 * or throws on an invalid RRULE.
 */
export async function createSchedule(
  db: Db,
  userId: string,
  listId: string,
  input: CreateScheduleInput,
): Promise<Schedule | null> {
  const list = await getVisibleList(db, userId, listId);
  if (!list) return null;
  if (!isValidRRule(input.rrule, input.dtstart)) {
    throw new Error("Invalid recurrence rule");
  }

  return db
    .insert(schedules)
    .values({
      id: uuidv7(),
      listId,
      title: input.title,
      rrule: input.rrule,
      dtstart: input.dtstart,
      timezone: input.timezone,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** A visible Schedule by id, or null. */
async function getVisibleSchedule(
  db: Db,
  userId: string,
  scheduleId: string,
): Promise<Schedule | null> {
  const schedule = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .get();
  if (!schedule) return null;
  // Authorize via the owning List's visibility.
  const list = await getVisibleList(db, userId, schedule.listId);
  return list ? schedule : null;
}

/** Delete a Schedule in a visible List (cascades its persisted Occurrences). */
export async function deleteSchedule(
  db: Db,
  userId: string,
  scheduleId: string,
): Promise<boolean> {
  const schedule = await getVisibleSchedule(db, userId, scheduleId);
  if (!schedule) return false;
  await db.delete(schedules).where(eq(schedules.id, scheduleId)).run();
  return true;
}

/**
 * Occurrences of a Schedule within [from, to]: expand the rule, then merge any
 * persisted rows (completed/skipped/override) by instant. Returns null if the
 * Schedule is not visible.
 */
export async function listOccurrences(
  db: Db,
  userId: string,
  scheduleId: string,
  fromIso: string,
  toIso: string,
): Promise<ComputedOccurrence[] | null> {
  const schedule = await getVisibleSchedule(db, userId, scheduleId);
  if (!schedule) return null;

  const instants = expandOccurrences(
    schedule.rrule,
    schedule.dtstart,
    fromIso,
    toIso,
  );

  // Persisted state rows in the window, keyed by instant.
  const rows = await db
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.scheduleId, scheduleId),
        gte(occurrences.occurrenceAt, fromIso),
        lte(occurrences.occurrenceAt, toIso),
      ),
    )
    .all();
  const byInstant = new Map(rows.map((r) => [r.occurrenceAt, r]));

  return instants.map((at) => {
    const row = byInstant.get(at);
    return {
      scheduleId,
      occurrenceAt: at,
      title: row?.overrideTitle ?? schedule.title,
      completed: row?.completed === 1,
      skipped: row?.skipped === 1,
      overrideAt: row?.overrideAt ?? null,
    };
  });
}

// State to set on a single Occurrence. Each field is tri-state: omitted leaves
// the current value, while `null`/empty clears an override back to the
// Schedule's default. `overrideAt` reschedules just this Occurrence to a
// different instant (the rule slot it belongs to is still its identity).
export type OccurrenceState = {
  completed?: boolean;
  skipped?: boolean;
  overrideTitle?: string | null;
  overrideAt?: string | null;
};

// Normalize an override input: undefined => keep current; ""/whitespace/null =>
// clear; otherwise the trimmed value.
function resolveOverride(
  input: string | null | undefined,
  current: string | null,
): string | null {
  if (input === undefined) return current;
  if (input === null) return null;
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Set state for one Occurrence (identified by its canonical rule instant),
 * upserting the persisted row (ADR-0004: a row exists only when it carries
 * state). Handles completed/skipped flags and the one-off overrides
 * (overrideTitle, overrideAt). When nothing is left to remember, the row is
 * removed to stay computed-only. Returns the resulting state, or null if the
 * Schedule is not visible.
 */
export async function setOccurrenceState(
  db: Db,
  userId: string,
  scheduleId: string,
  occurrenceAt: string,
  state: OccurrenceState,
): Promise<ComputedOccurrence | null> {
  const schedule = await getVisibleSchedule(db, userId, scheduleId);
  if (!schedule) return null;

  const existing = await db
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.scheduleId, scheduleId),
        eq(occurrences.occurrenceAt, occurrenceAt),
      ),
    )
    .get();

  const completed = state.completed ?? existing?.completed === 1;
  const skipped = state.skipped ?? existing?.skipped === 1;
  const overrideTitle = resolveOverride(
    state.overrideTitle,
    existing?.overrideTitle ?? null,
  );
  const overrideAt = resolveOverride(
    state.overrideAt,
    existing?.overrideAt ?? null,
  );

  const hasState =
    completed || skipped || overrideTitle !== null || overrideAt !== null;

  if (!hasState) {
    // Nothing to remember -> delete the row (stay computed-only).
    if (existing) {
      await db
        .delete(occurrences)
        .where(eq(occurrences.id, existing.id))
        .run();
    }
  } else if (existing) {
    await db
      .update(occurrences)
      .set({
        completed: completed ? 1 : 0,
        skipped: skipped ? 1 : 0,
        overrideTitle,
        overrideAt,
      })
      .where(eq(occurrences.id, existing.id))
      .run();
  } else {
    await db
      .insert(occurrences)
      .values({
        id: uuidv7(),
        scheduleId,
        occurrenceAt,
        completed: completed ? 1 : 0,
        skipped: skipped ? 1 : 0,
        overrideTitle,
        overrideAt,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  return {
    scheduleId,
    occurrenceAt,
    title: overrideTitle ?? schedule.title,
    completed,
    skipped,
    overrideAt,
  };
}
