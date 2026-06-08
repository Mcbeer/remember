import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, schema } from "../src/worker/db/index.ts";
import { uuidv7 } from "../src/worker/db/id.ts";
import {
  createFamily,
  listFamiliesForUser,
  leaveFamily,
} from "../src/worker/repo/families.ts";
import {
  generateInvite,
  acceptInvite,
} from "../src/worker/repo/invites.ts";
import { createList } from "../src/worker/repo/lists.ts";
import { listVisibleLists } from "../src/worker/repo/lists.ts";
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

beforeEach(async () => {
  await db.delete(schema.items).run();
  await db.delete(schema.lists).run();
  await db.delete(schema.invites).run();
  await db.delete(schema.memberships).run();
  await db.delete(schema.families).run();
  await db.delete(schema.users).run();
});

describe("Family creation & membership", () => {
  it("creator becomes the first Member", async () => {
    const alice = await makeUser();
    const fam = await createFamily(db, alice, "The Smiths");

    const mine = await listFamiliesForUser(db, alice);
    expect(mine.map((f) => f.id)).toEqual([fam.id]);
  });

  it("non-members do not see the Family", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await createFamily(db, alice, "The Smiths");
    expect(await listFamiliesForUser(db, bob)).toEqual([]);
  });
});

describe("Invites", () => {
  it("a Member can generate an invite; a non-member cannot", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const fam = await createFamily(db, alice, "Fam");

    const invite = await generateInvite(db, alice, fam.id);
    expect(invite.secret).toBeTruthy();

    await expect(generateInvite(db, carol, fam.id)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("regenerating replaces the old secret (old stops working)", async () => {
    const alice = await makeUser();
    const fam = await createFamily(db, alice, "Fam");

    const first = await generateInvite(db, alice, fam.id);
    const second = await generateInvite(db, alice, fam.id);
    expect(second.secret).not.toBe(first.secret);

    // Only one invite row per family.
    expect(await db.select().from(schema.invites).all()).toHaveLength(1);

    const bob = await makeUser();
    expect((await acceptInvite(db, bob, first.secret)).status).toBe("invalid");
    expect((await acceptInvite(db, bob, second.secret)).status).toBe("joined");
  });

  it("accepting adds the User and shares the Family's Lists", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const shared = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "family", familyId: fam.id },
    });

    const invite = await generateInvite(db, alice, fam.id);
    const result = await acceptInvite(db, bob, invite.secret);
    expect(result.status).toBe("joined");

    // Bob now sees the family List.
    expect((await listVisibleLists(db, bob)).map((l) => l.id)).toContain(
      shared.id,
    );
  });

  it("accepting twice is idempotent", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const invite = await generateInvite(db, alice, fam.id);

    expect((await acceptInvite(db, bob, invite.secret)).status).toBe("joined");
    expect((await acceptInvite(db, bob, invite.secret)).status).toBe(
      "already_member",
    );
    // No duplicate membership.
    expect(await db.select().from(schema.memberships).all()).toHaveLength(2);
  });

  it("expired invites are rejected", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const invite = await generateInvite(db, alice, fam.id);

    await db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eqSecret(invite.secret))
      .run();

    expect((await acceptInvite(db, bob, invite.secret)).status).toBe("expired");
  });

  it("invalid secrets are rejected", async () => {
    const bob = await makeUser();
    expect((await acceptInvite(db, bob, "nope")).status).toBe("invalid");
  });
});

describe("Leaving a Family (ADR-0002)", () => {
  it("a non-last Member just leaves; Family and Lists remain", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const invite = await generateInvite(db, alice, fam.id);
    await acceptInvite(db, bob, invite.secret);
    const shared = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "family", familyId: fam.id },
    });

    const res = await leaveFamily(db, bob, fam.id);
    expect(res).toEqual({ left: true, familyDeleted: false });

    expect(await listFamiliesForUser(db, bob)).toEqual([]);
    // Alice still has the family and its list.
    expect((await listVisibleLists(db, alice)).map((l) => l.id)).toContain(
      shared.id,
    );
  });

  it("the last Member leaving deletes the Family and cascades its Lists/Items", async () => {
    const alice = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const shared = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "family", familyId: fam.id },
    });

    const res = await leaveFamily(db, alice, fam.id);
    expect(res).toEqual({ left: true, familyDeleted: true });

    expect(await db.select().from(schema.families).all()).toEqual([]);
    expect(await db.select().from(schema.lists).all()).toEqual([]);
    // The List is gone for Alice.
    expect((await listVisibleLists(db, alice)).map((l) => l.id)).not.toContain(
      shared.id,
    );
  });

  it("leaving a Family you're not in is a no-op", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    expect(await leaveFamily(db, carol, fam.id)).toEqual({ left: false });
  });
});

// local helper to avoid importing eq twice
import { eq } from "drizzle-orm";
function eqSecret(secret: string) {
  return eq(schema.invites.secret, secret);
}
