import { and, eq } from "drizzle-orm";
import { items, lists } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";
import { visibleListPredicate } from "./visibility.ts";
import { getVisibleList } from "./lists.ts";

export type Item = typeof items.$inferSelect;

// Items inherit their List's visibility. Every read joins through the visible
// List predicate; every write first authorizes the target List via the List
// repo. There is no way to reach an Item whose List the User cannot see.

/** Items in a visible List, or empty if the List is not visible. */
export function listItems(
  db: Db,
  userId: string,
  listId: string,
): Promise<Item[]> {
  return db
    .select({
      id: items.id,
      listId: items.listId,
      title: items.title,
      completed: items.completed,
      dueAt: items.dueAt,
      dueTimezone: items.dueTimezone,
      origin: items.origin,
      status: items.status,
      createdBy: items.createdBy,
      createdAt: items.createdAt,
    })
    .from(items)
    .innerJoin(lists, eq(items.listId, lists.id))
    .where(and(eq(items.listId, listId), visibleListPredicate(userId)))
    .all();
}

/** A single Item in a visible List, or null. */
export async function getItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<Item | null> {
  const row = await db
    .select({
      id: items.id,
      listId: items.listId,
      title: items.title,
      completed: items.completed,
      dueAt: items.dueAt,
      dueTimezone: items.dueTimezone,
      origin: items.origin,
      status: items.status,
      createdBy: items.createdBy,
      createdAt: items.createdAt,
    })
    .from(items)
    .innerJoin(lists, eq(items.listId, lists.id))
    .where(and(eq(items.id, itemId), visibleListPredicate(userId)))
    .get();
  return row ?? null;
}

export type CreateItemInput = {
  title: string;
  due?: { at: string; timezone: string };
  origin?: "user" | "ingested";
  status?: "active" | "pending";
};

/**
 * Add an Item to a List the User can see. Returns null if the List is not
 * visible (caller -> 404). created_by is the caller.
 */
export async function createItem(
  db: Db,
  userId: string,
  listId: string,
  input: CreateItemInput,
): Promise<Item | null> {
  const list = await getVisibleList(db, userId, listId);
  if (!list) return null;

  const row = await db
    .insert(items)
    .values({
      id: uuidv7(),
      listId,
      title: input.title,
      completed: 0,
      dueAt: input.due?.at ?? null,
      dueTimezone: input.due?.timezone ?? null,
      origin: input.origin ?? "user",
      status: input.status ?? "active",
      createdBy: userId,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return row;
}

/** Set an Item's completed state. Returns the updated Item, or null. */
export async function setItemCompleted(
  db: Db,
  userId: string,
  itemId: string,
  completed: boolean,
): Promise<Item | null> {
  const existing = await getItem(db, userId, itemId);
  if (!existing) return null;

  const row = await db
    .update(items)
    .set({ completed: completed ? 1 : 0 })
    .where(eq(items.id, itemId))
    .returning()
    .get();
  return row ?? null;
}

// Partial edit of an Item. `title` updates the title when present. `due` is
// tri-state: omitted = leave unchanged, null = clear the due time, object = set
// it (UTC instant + IANA timezone, kept as a pair per the schema CHECK).
export type UpdateItemInput = {
  title?: string;
  due?: { at: string; timezone: string } | null;
};

/** Edit a visible Item's title and/or due time. Returns the updated Item, or null. */
export async function updateItem(
  db: Db,
  userId: string,
  itemId: string,
  input: UpdateItemInput,
): Promise<Item | null> {
  const existing = await getItem(db, userId, itemId);
  if (!existing) return null;

  const patch: Partial<typeof items.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.due !== undefined) {
    if (input.due === null) {
      patch.dueAt = null;
      patch.dueTimezone = null;
    } else {
      patch.dueAt = input.due.at;
      patch.dueTimezone = input.due.timezone;
    }
  }

  // Nothing to change.
  if (Object.keys(patch).length === 0) return existing;

  const row = await db
    .update(items)
    .set(patch)
    .where(eq(items.id, itemId))
    .returning()
    .get();
  return row ?? null;
}

/** Delete an Item in a visible List. True if deleted. */
export async function deleteItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<boolean> {
  const existing = await getItem(db, userId, itemId);
  if (!existing) return false;

  await db.delete(items).where(eq(items.id, itemId)).run();
  return true;
}
