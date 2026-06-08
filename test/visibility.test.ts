import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/worker/db/index.ts";
import { uuidv7 } from "../src/worker/db/id.ts";
import { schema } from "../src/worker/db/index.ts";
import {
  createList,
  getVisibleList,
  listVisibleLists,
  renameList,
  deleteList,
} from "../src/worker/repo/lists.ts";
import {
  createItem,
  getItem,
  listItems,
} from "../src/worker/repo/items.ts";
import { AuthorizationError } from "../src/worker/repo/errors.ts";

const db = createDb(env.DB);

async function makeUser(): Promise<string> {
  const id = uuidv7();
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@t.test`, createdAt: new Date().toISOString() })
    .run();
  return id;
}

async function makeFamilyWith(...userIds: string[]): Promise<string> {
  const familyId = uuidv7();
  await db
    .insert(schema.families)
    .values({ id: familyId, name: "Fam", createdAt: new Date().toISOString() })
    .run();
  for (const userId of userIds) {
    await db
      .insert(schema.memberships)
      .values({
        id: uuidv7(),
        userId,
        familyId,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
  return familyId;
}

// Each test starts from a clean slate so IDs/visibility don't leak across tests.
beforeEach(async () => {
  await db.delete(schema.items).run();
  await db.delete(schema.lists).run();
  await db.delete(schema.memberships).run();
  await db.delete(schema.invites).run();
  await db.delete(schema.families).run();
  await db.delete(schema.oauthIdentities).run();
  await db.delete(schema.users).run();
});

describe("List visibility (ADR-0002)", () => {
  it("a User sees their own personal List", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Alice personal",
      owner: { type: "personal" },
    });

    expect(await getVisibleList(db, alice, list.id)).not.toBeNull();
    const all = await listVisibleLists(db, alice);
    expect(all.map((l) => l.id)).toEqual([list.id]);
  });

  it("a User CANNOT see another User's personal List (reads as not-found)", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Alice personal",
      owner: { type: "personal" },
    });

    expect(await getVisibleList(db, bob, list.id)).toBeNull();
    expect(await listVisibleLists(db, bob)).toEqual([]);
  });

  it("Family members share visibility of a Family List", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const family = await makeFamilyWith(alice, bob);

    const shared = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "family", familyId: family },
    });

    expect(await getVisibleList(db, bob, shared.id)).not.toBeNull();
    expect((await listVisibleLists(db, bob)).map((l) => l.id)).toContain(
      shared.id,
    );
  });

  it("a non-member CANNOT see a Family's List", async () => {
    const alice = await makeUser();
    const carol = await makeUser(); // not in the family
    const family = await makeFamilyWith(alice);

    const shared = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "family", familyId: family },
    });

    expect(await getVisibleList(db, carol, shared.id)).toBeNull();
    expect(await listVisibleLists(db, carol)).toEqual([]);
  });

  it("creating a List in a Family you do not belong to is rejected", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const family = await makeFamilyWith(alice);

    await expect(
      createList(db, carol, {
        name: "Sneaky",
        owner: { type: "family", familyId: family },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a User cannot rename or delete a List they cannot see", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Alice personal",
      owner: { type: "personal" },
    });

    expect(await renameList(db, bob, list.id, "hacked")).toBeNull();
    expect(await deleteList(db, bob, list.id)).toBe(false);
    // Still intact for Alice.
    const still = await getVisibleList(db, alice, list.id);
    expect(still?.name).toBe("Alice personal");
  });
});

describe("Item visibility inherits its List (ADR-0002)", () => {
  it("a User cannot read or add Items in a List they cannot see", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Alice personal",
      owner: { type: "personal" },
    });
    await createItem(db, alice, list.id, { title: "Milk" });

    // Bob sees nothing and cannot add.
    expect(await listItems(db, bob, list.id)).toEqual([]);
    expect(await createItem(db, bob, list.id, { title: "Sneaky" })).toBeNull();
  });

  it("Family members see each other's Items in a shared List", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const family = await makeFamilyWith(alice, bob);
    const shared = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "family", familyId: family },
    });

    const item = await createItem(db, alice, shared.id, { title: "Eggs" });
    expect(item).not.toBeNull();

    const bobView = await listItems(db, bob, shared.id);
    expect(bobView.map((i) => i.title)).toEqual(["Eggs"]);
    expect(await getItem(db, bob, item!.id)).not.toBeNull();
  });
});

describe("Item editing — title + due (UTC instant + tz pair)", () => {
  it("sets and clears a due time, keeping the at/timezone pair consistent", async () => {
    const { createItem, getItem } = await import("../src/worker/repo/items.ts");
    const { updateItem } = await import("../src/worker/repo/items.ts");
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "P",
      owner: { type: "personal" },
    });
    const item = await createItem(db, alice, list.id, { title: "Dentist" });
    expect(item).not.toBeNull();

    const withDue = await updateItem(db, alice, item!.id, {
      title: "Dentist appt",
      due: { at: "2026-06-09T15:30:00.000Z", timezone: "Europe/Copenhagen" },
    });
    expect(withDue?.title).toBe("Dentist appt");
    expect(withDue?.dueAt).toBe("2026-06-09T15:30:00.000Z");
    expect(withDue?.dueTimezone).toBe("Europe/Copenhagen");

    const cleared = await updateItem(db, alice, item!.id, { due: null });
    expect(cleared?.dueAt).toBeNull();
    expect(cleared?.dueTimezone).toBeNull();

    void getItem;
  });

  it("cannot edit an Item in a List you cannot see", async () => {
    const { createItem, updateItem } = await import("../src/worker/repo/items.ts");
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "P",
      owner: { type: "personal" },
    });
    const item = await createItem(db, alice, list.id, { title: "Secret" });
    expect(await updateItem(db, bob, item!.id, { title: "hacked" })).toBeNull();
  });
});
