import { sql, type SQL } from "drizzle-orm";
import { lists, memberships } from "../db/schema.ts";
import type { Db } from "../db/index.ts";

// The single source of truth for "which Lists can this User see" (ADR-0002).
//
// A List is visible to a User iff the User owns it personally, OR the List is
// owned by a Family the User has a Membership in. Items, Schedules, and
// Occurrences inherit their List's visibility, so every List-scoped repository
// query composes this predicate. Invisible Lists are indistinguishable from
// non-existent ones (callers map empty results to 404), so we never leak the
// existence of other Users'/Families' data.

/**
 * SQL predicate selecting Lists visible to `userId`. Reference it against the
 * `lists` table (its `owner_user_id` / `owner_family_id` columns).
 */
export function visibleListPredicate(userId: string): SQL {
  return sql`(
    ${lists.ownerUserId} = ${userId}
    OR ${lists.ownerFamilyId} IN (
      SELECT ${memberships.familyId}
      FROM ${memberships}
      WHERE ${memberships.userId} = ${userId}
    )
  )`;
}

/**
 * True if `userId` has a Membership in `familyId`. Gate for writes that target a
 * Family-owned List (creating the List, or adding Items/Schedules to it).
 */
export async function isFamilyMember(
  db: Db,
  userId: string,
  familyId: string,
): Promise<boolean> {
  const row = await db.get<{ ok: number }>(sql`
    SELECT 1 AS ok
    FROM ${memberships}
    WHERE ${memberships.userId} = ${userId}
      AND ${memberships.familyId} = ${familyId}
    LIMIT 1
  `);
  return row?.ok === 1;
}
