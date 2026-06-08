import { and, eq, sql } from "drizzle-orm";
import { families, memberships } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";

export type Family = typeof families.$inferSelect;

// Families are flat — all Memberships are equal (ADR-0002). Every function is
// scoped by the caller's Membership; there are no roles to check.

/** Create a Family and make the creator its first Member. */
export async function createFamily(
  db: Db,
  userId: string,
  name: string,
): Promise<Family> {
  const now = new Date().toISOString();
  const family = await db
    .insert(families)
    .values({ id: uuidv7(), name, createdAt: now })
    .returning()
    .get();

  await db
    .insert(memberships)
    .values({ id: uuidv7(), userId, familyId: family.id, createdAt: now })
    .run();

  return family;
}

/** The Families the User belongs to. */
export function listFamiliesForUser(
  db: Db,
  userId: string,
): Promise<Family[]> {
  return db
    .select({
      id: families.id,
      name: families.name,
      createdAt: families.createdAt,
    })
    .from(families)
    .innerJoin(memberships, eq(memberships.familyId, families.id))
    .where(eq(memberships.userId, userId))
    .all();
}

/** Number of Members in a Family. */
async function memberCount(db: Db, familyId: string): Promise<number> {
  const row = await db.get<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM ${memberships}
    WHERE ${memberships.familyId} = ${familyId}
  `);
  return row?.n ?? 0;
}

export type LeaveResult =
  | { left: true; familyDeleted: boolean }
  | { left: false }; // not a member

/**
 * Leave a Family. If the caller was the last Member, the Family (and its Lists
 * and Items, via FK cascade) is deleted (ADR-0002). Returns whether the caller
 * was a member and whether the Family was deleted.
 */
export async function leaveFamily(
  db: Db,
  userId: string,
  familyId: string,
): Promise<LeaveResult> {
  const membership = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.familyId, familyId),
      ),
    )
    .get();

  if (!membership) return { left: false };

  const wasLast = (await memberCount(db, familyId)) <= 1;

  if (wasLast) {
    // Deleting the Family cascades to memberships, lists, items, invites.
    await db.delete(families).where(eq(families.id, familyId)).run();
    return { left: true, familyDeleted: true };
  }

  await db.delete(memberships).where(eq(memberships.id, membership.id)).run();
  return { left: true, familyDeleted: false };
}
