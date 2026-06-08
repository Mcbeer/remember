import { and, eq } from "drizzle-orm";
import { lists, families } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";
import { visibleListPredicate, isFamilyMember } from "./visibility.ts";
import { AuthorizationError } from "./errors.ts";

export type List = typeof lists.$inferSelect;

// A visible List enriched with its owning Family's name (null for personal
// Lists), so the UI can group lists by owner without a second round-trip.
export type ListWithOwner = List & { familyName: string | null };

// Every function takes `userId` first and scopes through visibleListPredicate,
// so a caller cannot read or mutate a List outside the User's visible set
// (ADR-0002). Reads of invisible Lists return null/empty (routes -> 404).

/** All Lists visible to the User: their personal Lists + their Families' Lists. */
export function listVisibleLists(db: Db, userId: string): Promise<List[]> {
  return db
    .select()
    .from(lists)
    .where(visibleListPredicate(userId))
    .all();
}

/** Visible Lists with their owning Family's name (null for personal Lists). */
export function listVisibleListsWithOwner(
  db: Db,
  userId: string,
): Promise<ListWithOwner[]> {
  return db
    .select({
      id: lists.id,
      name: lists.name,
      ownerUserId: lists.ownerUserId,
      ownerFamilyId: lists.ownerFamilyId,
      createdAt: lists.createdAt,
      familyName: families.name,
    })
    .from(lists)
    .leftJoin(families, eq(lists.ownerFamilyId, families.id))
    .where(visibleListPredicate(userId))
    .all();
}

/** A single visible List, or null if it does not exist or is not visible. */
export async function getVisibleList(
  db: Db,
  userId: string,
  listId: string,
): Promise<List | null> {
  const row = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), visibleListPredicate(userId)))
    .get();
  return row ?? null;
}

export type CreateListInput =
  | { name: string; owner: { type: "personal" } }
  | { name: string; owner: { type: "family"; familyId: string } };

/**
 * Create a List owned by the User (personal) or by a Family they belong to.
 * Personal Lists are always owned by the caller; family Lists require a
 * Membership, else AuthorizationError.
 */
export async function createList(
  db: Db,
  userId: string,
  input: CreateListInput,
): Promise<List> {
  const id = uuidv7();
  const createdAt = new Date().toISOString();

  if (input.owner.type === "personal") {
    const row = await db
      .insert(lists)
      .values({
        id,
        name: input.name,
        ownerUserId: userId,
        ownerFamilyId: null,
        createdAt,
      })
      .returning()
      .get();
    return row;
  }

  const member = await isFamilyMember(db, userId, input.owner.familyId);
  if (!member) {
    throw new AuthorizationError(
      "Cannot create a List in a Family you are not a member of",
    );
  }

  const row = await db
    .insert(lists)
    .values({
      id,
      name: input.name,
      ownerUserId: null,
      ownerFamilyId: input.owner.familyId,
      createdAt,
    })
    .returning()
    .get();
  return row;
}

/** Rename a visible List. Returns the updated List, or null if not visible. */
export async function renameList(
  db: Db,
  userId: string,
  listId: string,
  name: string,
): Promise<List | null> {
  // Authorize via a scoped read first; only then mutate by id.
  const existing = await getVisibleList(db, userId, listId);
  if (!existing) return null;

  const row = await db
    .update(lists)
    .set({ name })
    .where(eq(lists.id, listId))
    .returning()
    .get();
  return row ?? null;
}

/** Delete a visible List (cascades to its Items/Schedules). True if deleted. */
export async function deleteList(
  db: Db,
  userId: string,
  listId: string,
): Promise<boolean> {
  const existing = await getVisibleList(db, userId, listId);
  if (!existing) return false;

  await db.delete(lists).where(eq(lists.id, listId)).run();
  return true;
}
