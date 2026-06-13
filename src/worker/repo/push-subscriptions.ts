import { and, eq, inArray } from "drizzle-orm";
import { pushSubscriptions } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// Push subscriptions are per-device and owned by the User who created them.
// They carry no List scope: a subscription is just "this device can be pushed".
// Reminder fan-out (which device gets which message) is decided at send time
// from the Reminder's List ownership, not here.

export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Register (or refresh) a device subscription for a User. `endpoint` is unique
 * across the table; if the same device re-subscribes (keys rotated), we update
 * the existing row in place rather than creating a duplicate.
 */
export async function saveSubscription(
  db: Db,
  userId: string,
  input: SubscriptionInput,
): Promise<PushSubscription> {
  const existing = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, input.endpoint))
    .get();

  if (existing) {
    const row = await db
      .update(pushSubscriptions)
      .set({ userId, p256dh: input.p256dh, auth: input.auth })
      .where(eq(pushSubscriptions.endpoint, input.endpoint))
      .returning()
      .get();
    return row;
  }

  const row = await db
    .insert(pushSubscriptions)
    .values({
      id: uuidv7(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return row;
}

/** Remove a device subscription owned by the User. True if a row was deleted. */
export async function deleteSubscription(
  db: Db,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, userId),
      ),
    )
    .get();
  if (!existing) return false;

  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.id, existing.id))
    .run();
  return true;
}

/** All device subscriptions for a set of Users (the recipients of a Reminder). */
export function subscriptionsForUsers(
  db: Db,
  userIds: string[],
): Promise<PushSubscription[]> {
  if (userIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))
    .all();
}

/** Prune a dead subscription (push service returned 404/410) by endpoint. */
export async function pruneSubscription(
  db: Db,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .run();
}
