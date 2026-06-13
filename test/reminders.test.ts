import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../src/worker/db/index.ts";
import { uuidv7 } from "../src/worker/db/id.ts";
import { createList } from "../src/worker/repo/lists.ts";
import { createFamily } from "../src/worker/repo/families.ts";
import { createItem } from "../src/worker/repo/items.ts";
import { createSchedule } from "../src/worker/repo/schedules.ts";
import {
  createReminder,
  listReminders,
  deleteReminder,
} from "../src/worker/repo/reminders.ts";
import { collectDueReminders } from "../src/worker/push/scheduler.ts";

const db = createDb(env.DB);

async function makeUser(): Promise<string> {
  const id = uuidv7();
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@t.test`, createdAt: new Date().toISOString() })
    .run();
  return id;
}

beforeEach(async () => {
  await db.delete(schema.reminders).run();
  await db.delete(schema.occurrences).run();
  await db.delete(schema.schedules).run();
  await db.delete(schema.items).run();
  await db.delete(schema.lists).run();
  await db.delete(schema.memberships).run();
  await db.delete(schema.families).run();
  await db.delete(schema.users).run();
});

const GYM = {
  title: "Gymnastics",
  rrule: "FREQ=WEEKLY;BYDAY=TU",
  dtstart: "2026-06-02T15:30:00.000Z",
  timezone: "Europe/Copenhagen",
};

describe("Reminders repo (inherit anchor's List visibility)", () => {
  it("adds and lists a Reminder on a visible Item", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Mine",
      owner: { type: "personal" },
    });
    const item = await createItem(db, alice, list.id, {
      title: "Pay rent",
      due: { at: "2026-06-10T09:00:00.000Z", timezone: "UTC" },
    });

    const r = await createReminder(
      db,
      alice,
      { type: "item", itemId: item!.id },
      30,
    );
    expect(r).not.toBeNull();
    expect(r!.offsetMinutes).toBe(30);

    const list1 = await listReminders(db, alice, {
      type: "item",
      itemId: item!.id,
    });
    expect(list1.map((x) => x.id)).toEqual([r!.id]);
  });

  it("cannot add or see a Reminder on an Item in a List you cannot see", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Mine",
      owner: { type: "personal" },
    });
    const item = await createItem(db, alice, list.id, { title: "Secret" });

    expect(
      await createReminder(db, bob, { type: "item", itemId: item!.id }, 10),
    ).toBeNull();

    await createReminder(db, alice, { type: "item", itemId: item!.id }, 10);
    expect(
      await listReminders(db, bob, { type: "item", itemId: item!.id }),
    ).toEqual([]);
  });

  it("a Family member can manage a Reminder on a shared Item", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const family = await createFamily(db, alice, "Home");
    await db
      .insert(schema.memberships)
      .values({
        id: uuidv7(),
        userId: bob,
        familyId: family.id,
        createdAt: new Date().toISOString(),
      })
      .run();
    const list = await createList(db, alice, {
      name: "Chores",
      owner: { type: "family", familyId: family.id },
    });
    const item = await createItem(db, alice, list.id, {
      title: "Bins",
      due: { at: "2026-06-10T09:00:00.000Z", timezone: "UTC" },
    });

    // Bob (a Member) adds the reminder; Alice (another Member) removes it.
    const r = await createReminder(
      db,
      bob,
      { type: "item", itemId: item!.id },
      60,
    );
    expect(r).not.toBeNull();
    expect(await deleteReminder(db, alice, r!.id)).toBe(true);
  });

  it("adds a Reminder on a visible Schedule", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const r = await createReminder(
      db,
      alice,
      { type: "schedule", scheduleId: s!.id },
      60,
    );
    expect(r).not.toBeNull();
    expect(
      (await listReminders(db, alice, { type: "schedule", scheduleId: s!.id }))
        .length,
    ).toBe(1);
  });

  it("deleting an Item cascades its Reminders", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Mine",
      owner: { type: "personal" },
    });
    const item = await createItem(db, alice, list.id, {
      title: "X",
      due: { at: "2026-06-10T09:00:00.000Z", timezone: "UTC" },
    });
    await createReminder(db, alice, { type: "item", itemId: item!.id }, 10);

    await db.delete(schema.items).where(eq(schema.items.id, item!.id)).run();
    expect(await db.select().from(schema.reminders).all()).toHaveLength(0);
  });
});

describe("Scheduler: collectDueReminders", () => {
  it("fires an Item reminder once its offset window is reached, to the owner", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Mine",
      owner: { type: "personal" },
    });
    const dueAt = "2026-06-10T09:00:00.000Z";
    const item = await createItem(db, alice, list.id, {
      title: "Pay rent",
      due: { at: dueAt, timezone: "UTC" },
    });
    await createReminder(db, alice, { type: "item", itemId: item!.id }, 30);

    // 31 minutes before due: not yet (fire is at due-30 = 08:30).
    const before = new Date("2026-06-10T08:29:00.000Z").getTime();
    expect(await collectDueReminders(db, before)).toEqual([]);

    // 08:35 — fire window reached.
    const at = new Date("2026-06-10T08:35:00.000Z").getTime();
    const jobs = await collectDueReminders(db, at);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].recipientUserIds).toEqual([alice]);
    expect(jobs[0].dueAt).toBe(dueAt);
    expect(jobs[0].title).toBe("Pay rent");
  });

  it("does not re-fire an Item reminder already sent for that dueAt", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Mine",
      owner: { type: "personal" },
    });
    const dueAt = "2026-06-10T09:00:00.000Z";
    const item = await createItem(db, alice, list.id, {
      title: "Pay rent",
      due: { at: dueAt, timezone: "UTC" },
    });
    const r = await createReminder(
      db,
      alice,
      { type: "item", itemId: item!.id },
      30,
    );
    // Mark as already sent for this dueAt.
    await db
      .update(schema.reminders)
      .set({ lastSentAt: dueAt })
      .where(eq(schema.reminders.id, r!.id))
      .run();

    const at = new Date("2026-06-10T08:35:00.000Z").getTime();
    expect(await collectDueReminders(db, at)).toEqual([]);
  });

  it("fans a shared-Item reminder out to all Family Members", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const family = await createFamily(db, alice, "Home");
    await db
      .insert(schema.memberships)
      .values({
        id: uuidv7(),
        userId: bob,
        familyId: family.id,
        createdAt: new Date().toISOString(),
      })
      .run();
    const list = await createList(db, alice, {
      name: "Chores",
      owner: { type: "family", familyId: family.id },
    });
    const item = await createItem(db, alice, list.id, {
      title: "Bins",
      due: { at: "2026-06-10T09:00:00.000Z", timezone: "UTC" },
    });
    await createReminder(db, bob, { type: "item", itemId: item!.id }, 0);

    const at = new Date("2026-06-10T09:00:30.000Z").getTime();
    const jobs = await collectDueReminders(db, at);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].recipientUserIds.sort()).toEqual([alice, bob].sort());
  });

  it("fires a Schedule reminder for the next Occurrence", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    // 60-minute lead before the Tuesday 15:30 occurrence.
    await createReminder(db, alice, { type: "schedule", scheduleId: s!.id }, 60);

    // First Tuesday occurrence: 2026-06-02T15:30Z. Fire at 14:30Z.
    const before = new Date("2026-06-02T14:00:00.000Z").getTime();
    expect(await collectDueReminders(db, before)).toEqual([]);

    const at = new Date("2026-06-02T14:35:00.000Z").getTime();
    const jobs = await collectDueReminders(db, at);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].dueAt).toBe("2026-06-02T15:30:00.000Z");
    expect(jobs[0].recipientUserIds).toEqual([alice]);
  });
});
