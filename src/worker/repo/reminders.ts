import { eq } from "drizzle-orm";
import { items, schedules, reminders } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";
import { getVisibleList } from "./lists.ts";

export type Reminder = typeof reminders.$inferSelect;

// A Reminder is shared like the Item/Schedule it attaches to (CONTEXT
// "Reminder"). It inherits that anchor's List visibility: any User who can see
// the List can add, list, or remove its Reminders. Exactly one of itemId /
// scheduleId is set (schema CHECK). Authorization always goes through the owning
// List, mirroring the visibility spine (ADR-0002).

export type ReminderAnchor =
  | { type: "item"; itemId: string }
  | { type: "schedule"; scheduleId: string };

// Resolve the List that an anchor (Item or Schedule) belongs to, but only if the
// User can see that List. Returns the listId, or null when not visible/not found.
async function visibleAnchorListId(
  db: Db,
  userId: string,
  anchor: ReminderAnchor,
): Promise<string | null> {
  if (anchor.type === "item") {
    const item = await db
      .select({ listId: items.listId })
      .from(items)
      .where(eq(items.id, anchor.itemId))
      .get();
    if (!item) return null;
    const list = await getVisibleList(db, userId, item.listId);
    return list ? item.listId : null;
  }

  const schedule = await db
    .select({ listId: schedules.listId })
    .from(schedules)
    .where(eq(schedules.id, anchor.scheduleId))
    .get();
  if (!schedule) return null;
  const list = await getVisibleList(db, userId, schedule.listId);
  return list ? schedule.listId : null;
}

/** Reminders on a visible Item or Schedule, or empty if not visible. */
export async function listReminders(
  db: Db,
  userId: string,
  anchor: ReminderAnchor,
): Promise<Reminder[]> {
  const listId = await visibleAnchorListId(db, userId, anchor);
  if (!listId) return [];

  return db
    .select()
    .from(reminders)
    .where(
      anchor.type === "item"
        ? eq(reminders.itemId, anchor.itemId)
        : eq(reminders.scheduleId, anchor.scheduleId),
    )
    .all();
}

/**
 * Add a Reminder firing `offsetMinutes` before the anchor's due moment. Returns
 * null if the anchor's List is not visible (caller -> 404). created_by is the
 * caller, but the Reminder is shared (any Member of the owning Family can manage
 * it).
 */
export async function createReminder(
  db: Db,
  userId: string,
  anchor: ReminderAnchor,
  offsetMinutes: number,
): Promise<Reminder | null> {
  const listId = await visibleAnchorListId(db, userId, anchor);
  if (!listId) return null;

  const row = await db
    .insert(reminders)
    .values({
      id: uuidv7(),
      itemId: anchor.type === "item" ? anchor.itemId : null,
      scheduleId: anchor.type === "schedule" ? anchor.scheduleId : null,
      offsetMinutes,
      lastSentAt: null,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return row;
}

/** A visible Reminder by id, or null. Authorized through its anchor's List. */
async function getVisibleReminder(
  db: Db,
  userId: string,
  reminderId: string,
): Promise<Reminder | null> {
  const reminder = await db
    .select()
    .from(reminders)
    .where(eq(reminders.id, reminderId))
    .get();
  if (!reminder) return null;

  const anchor: ReminderAnchor = reminder.itemId
    ? { type: "item", itemId: reminder.itemId }
    : { type: "schedule", scheduleId: reminder.scheduleId! };
  const listId = await visibleAnchorListId(db, userId, anchor);
  return listId ? reminder : null;
}

/** Delete a Reminder on a visible anchor. True if deleted. */
export async function deleteReminder(
  db: Db,
  userId: string,
  reminderId: string,
): Promise<boolean> {
  const existing = await getVisibleReminder(db, userId, reminderId);
  if (!existing) return false;

  await db.delete(reminders).where(eq(reminders.id, reminderId)).run();
  return true;
}
