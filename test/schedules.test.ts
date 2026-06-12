import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, schema } from "../src/worker/db/index.ts";
import { uuidv7 } from "../src/worker/db/id.ts";
import { createList } from "../src/worker/repo/lists.ts";
import {
  createSchedule,
  listSchedules,
  listOccurrences,
  setOccurrenceState,
  deleteSchedule,
} from "../src/worker/repo/schedules.ts";

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
  await db.delete(schema.occurrences).run();
  await db.delete(schema.schedules).run();
  await db.delete(schema.lists).run();
  await db.delete(schema.users).run();
});

// Gymnastics: every Tuesday 17:30 CEST (15:30 UTC), anchored on a Tuesday.
const GYM = {
  title: "Gymnastics",
  rrule: "FREQ=WEEKLY;BYDAY=TU",
  dtstart: "2026-06-02T15:30:00.000Z",
  timezone: "Europe/Copenhagen",
};
const WINDOW = {
  from: "2026-06-01T00:00:00.000Z",
  to: "2026-06-30T23:59:59.000Z",
};

describe("Schedules", () => {
  it("creates a Schedule in a visible List and lists it", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    expect(s).not.toBeNull();
    expect((await listSchedules(db, alice, list.id)).map((x) => x.id)).toEqual([
      s!.id,
    ]);
  });

  it("cannot create or see a Schedule in a List you cannot see", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    expect(await createSchedule(db, bob, list.id, GYM)).toBeNull();

    await createSchedule(db, alice, list.id, GYM);
    expect(await listSchedules(db, bob, list.id)).toEqual([]);
  });

  it("rejects an invalid RRULE", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    await expect(
      createSchedule(db, alice, list.id, { ...GYM, rrule: "NOT_A_RULE" }),
    ).rejects.toThrow();
  });
});

describe("Occurrences (computed, merged with persisted state)", () => {
  it("expands the rule across a window", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);

    const occ = await listOccurrences(db, alice, s!.id, WINDOW.from, WINDOW.to);
    expect(occ).not.toBeNull();
    // Five Tuesdays in June 2026.
    expect(occ!.map((o) => o.occurrenceAt)).toEqual([
      "2026-06-02T15:30:00.000Z",
      "2026-06-09T15:30:00.000Z",
      "2026-06-16T15:30:00.000Z",
      "2026-06-23T15:30:00.000Z",
      "2026-06-30T15:30:00.000Z",
    ]);
    // All default to not-completed/not-skipped and the Schedule title.
    expect(occ!.every((o) => !o.completed && !o.skipped)).toBe(true);
    expect(occ![0].title).toBe("Gymnastics");
  });

  it("completing one Occurrence persists only that instant; others untouched", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);

    const target = "2026-06-09T15:30:00.000Z";
    await setOccurrenceState(db, alice, s!.id, target, { completed: true });

    const occ = await listOccurrences(db, alice, s!.id, WINDOW.from, WINDOW.to);
    const done = occ!.filter((o) => o.completed).map((o) => o.occurrenceAt);
    expect(done).toEqual([target]);
    // Exactly one persisted row.
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(1);
  });

  it("clearing all state removes the persisted row (stays computed-only)", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const target = "2026-06-09T15:30:00.000Z";

    await setOccurrenceState(db, alice, s!.id, target, { completed: true });
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(1);

    await setOccurrenceState(db, alice, s!.id, target, { completed: false });
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(0);
  });

  it("skipping one Occurrence marks just that instant skipped", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const target = "2026-06-16T15:30:00.000Z";

    await setOccurrenceState(db, alice, s!.id, target, { skipped: true });
    const occ = await listOccurrences(db, alice, s!.id, WINDOW.from, WINDOW.to);
    expect(occ!.filter((o) => o.skipped).map((o) => o.occurrenceAt)).toEqual([
      target,
    ]);
  });

  it("non-members cannot read or mutate occurrences", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);

    expect(
      await listOccurrences(db, bob, s!.id, WINDOW.from, WINDOW.to),
    ).toBeNull();
    expect(
      await setOccurrenceState(db, bob, s!.id, "2026-06-02T15:30:00.000Z", {
        completed: true,
      }),
    ).toBeNull();
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(0);
  });

  it("retitling one Occurrence overrides only that instant's title", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const target = "2026-06-09T15:30:00.000Z";

    const result = await setOccurrenceState(db, alice, s!.id, target, {
      overrideTitle: "Gymnastics (recital)",
    });
    expect(result!.title).toBe("Gymnastics (recital)");

    const occ = await listOccurrences(db, alice, s!.id, WINDOW.from, WINDOW.to);
    expect(
      occ!.find((o) => o.occurrenceAt === target)!.title,
    ).toBe("Gymnastics (recital)");
    // Other instants keep the Schedule's title.
    expect(
      occ!.filter((o) => o.occurrenceAt !== target).every(
        (o) => o.title === "Gymnastics",
      ),
    ).toBe(true);
    // One persisted row carrying the override.
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(1);
  });

  it("rescheduling one Occurrence sets overrideAt; identity stays the rule instant", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const target = "2026-06-09T15:30:00.000Z";
    const movedTo = "2026-06-10T18:00:00.000Z";

    const result = await setOccurrenceState(db, alice, s!.id, target, {
      overrideAt: movedTo,
    });
    expect(result!.overrideAt).toBe(movedTo);

    const occ = await listOccurrences(db, alice, s!.id, WINDOW.from, WINDOW.to);
    const row = occ!.find((o) => o.occurrenceAt === target)!;
    // Still keyed by the rule instant, but reports the moved-to time.
    expect(row.occurrenceAt).toBe(target);
    expect(row.overrideAt).toBe(movedTo);
    // The slot count is unchanged (reschedule, not add/remove).
    expect(occ!).toHaveLength(5);
  });

  it("clearing overrides (with no flags) removes the persisted row", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const target = "2026-06-09T15:30:00.000Z";

    await setOccurrenceState(db, alice, s!.id, target, {
      overrideTitle: "Moved",
      overrideAt: "2026-06-10T18:00:00.000Z",
    });
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(1);

    await setOccurrenceState(db, alice, s!.id, target, {
      overrideTitle: null,
      overrideAt: null,
    });
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(0);
  });

  it("overrides coexist with completed; clearing the override keeps the row while completed", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const target = "2026-06-09T15:30:00.000Z";

    await setOccurrenceState(db, alice, s!.id, target, {
      completed: true,
      overrideTitle: "Special",
    });
    // Clear just the title; completed remains, so the row stays.
    const after = await setOccurrenceState(db, alice, s!.id, target, {
      overrideTitle: null,
    });
    expect(after!.completed).toBe(true);
    expect(after!.title).toBe("Gymnastics");
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(1);
  });

  it("an empty/whitespace override title is treated as clear", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    const target = "2026-06-09T15:30:00.000Z";

    const result = await setOccurrenceState(db, alice, s!.id, target, {
      overrideTitle: "   ",
    });
    expect(result!.title).toBe("Gymnastics");
    // Nothing to remember -> no row.
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(0);
  });

  it("deleting a Schedule cascades its persisted occurrences", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const s = await createSchedule(db, alice, list.id, GYM);
    await setOccurrenceState(db, alice, s!.id, "2026-06-02T15:30:00.000Z", {
      completed: true,
    });

    expect(await deleteSchedule(db, alice, s!.id)).toBe(true);
    expect(await db.select().from(schema.occurrences).all()).toHaveLength(0);
    expect(await db.select().from(schema.schedules).all()).toHaveLength(0);
  });
});
