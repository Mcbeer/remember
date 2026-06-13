import { and, eq, isNotNull } from "drizzle-orm";
import {
  items,
  schedules,
  lists,
  memberships,
  reminders,
} from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { expandOccurrences } from "../repo/occurrence-expansion.ts";
import { subscriptionsForUsers, pruneSubscription } from "../repo/push-subscriptions.ts";
import { sendWebPush, type VapidKeys } from "./web-push.ts";

// The cron scheduler's job: find Reminders whose fire moment has arrived and
// push every recipient, exactly once per due moment.
//
//   * An Item reminder fires at (dueAt - offset). We record lastSentAt = dueAt
//     so it never re-sends for the same due moment.
//   * A Schedule reminder fires at (nextOccurrence - offset). We record
//     lastSentAt = that occurrence instant, so it advances slot to slot.
//
// Recipients are derived from the anchor's List ownership: a personal List's
// owner, or every Member of the owning Family (the "all Members" decision).

// What to push for one fired Reminder.
export type PushJob = {
  reminderId: string;
  // The due moment we are firing for (stored back as lastSentAt).
  dueAt: string;
  title: string;
  recipientUserIds: string[];
  // Where tapping the notification should take the user.
  url: string;
};

// Look back a bounded window so a Worker that missed a few cron ticks still
// catches recent fire moments, without resurrecting ancient ones.
const CATCHUP_MS = 1000 * 60 * 60; // 1 hour

/** Recipient Users for a List: its owning User, or all Members of its Family. */
async function recipientsForList(db: Db, listId: string): Promise<string[]> {
  const list = await db
    .select({
      ownerUserId: lists.ownerUserId,
      ownerFamilyId: lists.ownerFamilyId,
    })
    .from(lists)
    .where(eq(lists.id, listId))
    .get();
  if (!list) return [];

  if (list.ownerUserId) return [list.ownerUserId];

  if (list.ownerFamilyId) {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.familyId, list.ownerFamilyId))
      .all();
    return rows.map((r) => r.userId);
  }
  return [];
}

/**
 * Compute the PushJobs that are due as of `nowMs`. Pure read + decision: it does
 * not send or mutate. The scheduler sends them and then records lastSentAt.
 */
export async function collectDueReminders(
  db: Db,
  nowMs: number,
): Promise<PushJob[]> {
  const jobs: PushJob[] = [];

  // --- Item reminders: anchor has a concrete dueAt. ---
  const itemRows = await db
    .select({
      reminderId: reminders.id,
      offsetMinutes: reminders.offsetMinutes,
      lastSentAt: reminders.lastSentAt,
      itemId: items.id,
      title: items.title,
      dueAt: items.dueAt,
      listId: items.listId,
    })
    .from(reminders)
    .innerJoin(items, eq(reminders.itemId, items.id))
    .where(and(isNotNull(reminders.itemId), isNotNull(items.dueAt)))
    .all();

  for (const r of itemRows) {
    const dueAt = r.dueAt!;
    const fireMs = new Date(dueAt).getTime() - r.offsetMinutes * 60_000;
    const dueMs = new Date(dueAt).getTime();

    // Fire once when we've reached the fire moment, the due moment hasn't long
    // passed (catch-up window), and we haven't already sent for this dueAt.
    if (
      fireMs <= nowMs &&
      dueMs >= nowMs - CATCHUP_MS &&
      r.lastSentAt !== dueAt
    ) {
      const recipientUserIds = await recipientsForList(db, r.listId);
      if (recipientUserIds.length > 0) {
        jobs.push({
          reminderId: r.reminderId,
          dueAt,
          title: r.title,
          recipientUserIds,
          url: "/",
        });
      }
    }
  }

  // --- Schedule reminders: compute the next occurrence instant. ---
  const scheduleRows = await db
    .select({
      reminderId: reminders.id,
      offsetMinutes: reminders.offsetMinutes,
      lastSentAt: reminders.lastSentAt,
      scheduleId: schedules.id,
      title: schedules.title,
      rrule: schedules.rrule,
      dtstart: schedules.dtstart,
      listId: schedules.listId,
    })
    .from(reminders)
    .innerJoin(schedules, eq(reminders.scheduleId, schedules.id))
    .where(isNotNull(reminders.scheduleId))
    .all();

  for (const r of scheduleRows) {
    // Enumerate occurrences from a little before the catch-up window up to the
    // offset horizon, and find the earliest one whose fire moment has arrived
    // and that we haven't sent for yet.
    const windowFrom = new Date(nowMs - CATCHUP_MS).toISOString();
    const windowTo = new Date(
      nowMs + r.offsetMinutes * 60_000 + 60_000,
    ).toISOString();

    const occurrenceInstants = expandOccurrences(
      r.rrule,
      r.dtstart,
      windowFrom,
      windowTo,
    );

    for (const occAt of occurrenceInstants) {
      const fireMs = new Date(occAt).getTime() - r.offsetMinutes * 60_000;
      const occMs = new Date(occAt).getTime();
      if (
        fireMs <= nowMs &&
        occMs >= nowMs - CATCHUP_MS &&
        r.lastSentAt !== occAt
      ) {
        const recipientUserIds = await recipientsForList(db, r.listId);
        if (recipientUserIds.length > 0) {
          jobs.push({
            reminderId: r.reminderId,
            dueAt: occAt,
            title: r.title,
            recipientUserIds,
            url: "/",
          });
        }
        break; // one fire per reminder per run (the earliest pending occurrence)
      }
    }
  }

  return jobs;
}

/**
 * Run one scheduler tick: collect due Reminders, push each recipient's devices,
 * prune dead subscriptions, and record lastSentAt so each due moment fires once.
 */
export async function runReminderTick(
  db: Db,
  vapid: VapidKeys,
  nowMs = Date.now(),
): Promise<{ sent: number; pruned: number }> {
  const jobs = await collectDueReminders(db, nowMs);
  let sent = 0;
  let pruned = 0;

  for (const job of jobs) {
    const subs = await subscriptionsForUsers(db, job.recipientUserIds);

    for (const sub of subs) {
      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title: "Remember", body: job.title, url: job.url },
        vapid,
      );
      if (result.gone) {
        await pruneSubscription(db, sub.endpoint);
        pruned++;
      } else if (result.status >= 200 && result.status < 300) {
        sent++;
      }
    }

    // Record the due moment we fired for so it never double-sends.
    await db
      .update(reminders)
      .set({ lastSentAt: job.dueAt })
      .where(eq(reminders.id, job.reminderId))
      .run();
  }

  return { sent, pruned };
}
