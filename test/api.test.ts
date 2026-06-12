import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/worker/index.ts";
import { createDb, schema } from "../src/worker/db/index.ts";
import { uuidv7 } from "../src/worker/db/id.ts";
import { createFamily } from "../src/worker/repo/families.ts";
import { generateInvite, acceptInvite } from "../src/worker/repo/invites.ts";
import { createList } from "../src/worker/repo/lists.ts";
import { createSchedule } from "../src/worker/repo/schedules.ts";
import {
  generateSessionToken,
  createSession,
} from "../src/worker/auth/session.ts";
import { SESSION_COOKIE } from "../src/worker/auth/cookies.ts";

// These exercise the Hono routers end-to-end (auth middleware -> requireUser ->
// repo -> HTTP status mapping), complementing the repo-level tests. We drive the
// app via app.request(path, init, env); the session rides in a Cookie header
// just as the browser would send it.

const db = createDb(env.DB);

async function makeUser(): Promise<string> {
  const id = uuidv7();
  await db
    .insert(schema.users)
    .values({
      id,
      email: `${id}@t.test`,
      name: `User ${id.slice(0, 4)}`,
      createdAt: new Date().toISOString(),
    })
    .run();
  return id;
}

// A logged-in User: returns the Cookie header value carrying a live session.
async function login(userId: string): Promise<string> {
  const token = generateSessionToken();
  await createSession(db, token, userId);
  return `${SESSION_COOKIE}=${token}`;
}

function req(path: string, cookie?: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return app.request(path, { ...init, headers }, env);
}

beforeEach(async () => {
  await db.delete(schema.occurrences).run();
  await db.delete(schema.schedules).run();
  await db.delete(schema.items).run();
  await db.delete(schema.lists).run();
  await db.delete(schema.invites).run();
  await db.delete(schema.memberships).run();
  await db.delete(schema.families).run();
  await db.delete(schema.sessions).run();
  await db.delete(schema.users).run();
});

describe("auth gating", () => {
  it("rejects unauthenticated requests to protected routes with 401", async () => {
    const res = await req("/api/families");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects a bogus session cookie with 401", async () => {
    const res = await req("/api/families", `${SESSION_COOKIE}=not-a-real-token`);
    expect(res.status).toBe(401);
  });

  it("/api/me returns the current User when logged in", async () => {
    const alice = await makeUser();
    const res = await req("/api/me", await login(alice));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(alice);
  });
});

describe("GET /api/families", () => {
  it("lists only the caller's Families", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "The Smiths");
    await createFamily(db, bob, "The Joneses");

    const res = await req("/api/families", await login(alice));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string }[];
    expect(body.map((f) => f.id)).toEqual([fam.id]);
  });
});

describe("POST /api/families", () => {
  it("creates a Family and returns 201", async () => {
    const alice = await makeUser();
    const res = await req("/api/families", await login(alice), {
      method: "POST",
      body: JSON.stringify({ name: "The Smiths" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("The Smiths");
  });

  it("rejects a blank name with 400", async () => {
    const alice = await makeUser();
    const res = await req("/api/families", await login(alice), {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/families/:id/members", () => {
  it("returns the roster to a Member, oldest first", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const invite = await generateInvite(db, alice, fam.id);
    await acceptInvite(db, bob, invite.secret);

    const res = await req(
      `/api/families/${fam.id}/members`,
      await login(alice),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; email: string }[];
    expect(body.map((m) => m.userId)).toEqual([alice, bob]);
    // It exposes display fields but never a token/secret.
    expect(body[0]).toHaveProperty("name");
    expect(body[0]).toHaveProperty("email");
    expect(body[0]).not.toHaveProperty("id");
  });

  it("hides the roster from a non-member with 403", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const fam = await createFamily(db, alice, "Fam");

    const res = await req(
      `/api/families/${fam.id}/members`,
      await login(carol),
    );
    expect(res.status).toBe(403);
  });

  it("requires authentication (401)", async () => {
    const alice = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const res = await req(`/api/families/${fam.id}/members`);
    expect(res.status).toBe(401);
  });
});

describe("family invite + leave routes", () => {
  it("a Member can mint an invite (201); a non-member cannot (403)", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const fam = await createFamily(db, alice, "Fam");

    const ok = await req(
      `/api/families/${fam.id}/invite`,
      await login(alice),
      { method: "POST" },
    );
    expect(ok.status).toBe(201);
    expect((await ok.json()).secret).toBeTruthy();

    const denied = await req(
      `/api/families/${fam.id}/invite`,
      await login(carol),
      { method: "POST" },
    );
    expect(denied.status).toBe(403);
  });

  it("leaving a Family you're not in returns 404", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const fam = await createFamily(db, alice, "Fam");

    const res = await req(
      `/api/families/${fam.id}/leave`,
      await login(carol),
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  it("the last Member leaving deletes the Family", async () => {
    const alice = await makeUser();
    const fam = await createFamily(db, alice, "Fam");

    const res = await req(
      `/api/families/${fam.id}/leave`,
      await login(alice),
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ left: true, familyDeleted: true });
    expect(await db.select().from(schema.families).all()).toEqual([]);
  });
});

describe("lists router", () => {
  it("lists only visible Lists (personal + family), with familyName", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Smiths");
    const personal = await createList(db, alice, {
      name: "Mine",
      owner: { type: "personal" },
    });
    const shared = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "family", familyId: fam.id },
    });
    await createList(db, bob, { name: "Bob's", owner: { type: "personal" } });

    const res = await req("/api/lists", await login(alice));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      familyName: string | null;
    }[];
    expect(body.map((l) => l.id).sort()).toEqual(
      [personal.id, shared.id].sort(),
    );
    expect(body.find((l) => l.id === shared.id)!.familyName).toBe("Smiths");
    expect(body.find((l) => l.id === personal.id)!.familyName).toBeNull();
  });

  it("creates a personal List (201)", async () => {
    const alice = await makeUser();
    const res = await req("/api/lists", await login(alice), {
      method: "POST",
      body: JSON.stringify({ name: "Mine" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Mine");
    expect(body.ownerUserId).toBe(alice);
    expect(body.ownerFamilyId).toBeNull();
  });

  it("creates a family List for a Member (201)", async () => {
    const alice = await makeUser();
    const fam = await createFamily(db, alice, "Smiths");
    const res = await req("/api/lists", await login(alice), {
      method: "POST",
      body: JSON.stringify({ name: "Groceries", familyId: fam.id }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).ownerFamilyId).toBe(fam.id);
  });

  it("rejects creating a List in a Family you're not in (403)", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const fam = await createFamily(db, alice, "Smiths");
    const res = await req("/api/lists", await login(carol), {
      method: "POST",
      body: JSON.stringify({ name: "Sneaky", familyId: fam.id }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a blank name (400)", async () => {
    const alice = await makeUser();
    const res = await req("/api/lists", await login(alice), {
      method: "POST",
      body: JSON.stringify({ name: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /:id returns a visible List, 404 for another user's", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Mine",
      owner: { type: "personal" },
    });

    expect(
      (await req(`/api/lists/${list.id}`, await login(alice))).status,
    ).toBe(200);
    // Invisible == not-found (no existence leak).
    expect(
      (await req(`/api/lists/${list.id}`, await login(bob))).status,
    ).toBe(404);
  });

  it("renames a visible List; 404 for an invisible one", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Old",
      owner: { type: "personal" },
    });

    const ok = await req(`/api/lists/${list.id}`, await login(alice), {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).name).toBe("New");

    const denied = await req(`/api/lists/${list.id}`, await login(bob), {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijack" }),
    });
    expect(denied.status).toBe(404);
  });

  it("deletes a visible List (204); 404 for an invisible one", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Temp",
      owner: { type: "personal" },
    });

    expect(
      (
        await req(`/api/lists/${list.id}`, await login(bob), {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    const gone = await req(`/api/lists/${list.id}`, await login(alice), {
      method: "DELETE",
    });
    expect(gone.status).toBe(204);
    expect(await db.select().from(schema.lists).all()).toEqual([]);
  });
});

describe("items router", () => {
  async function makeList(userId: string) {
    return createList(db, userId, {
      name: "Mine",
      owner: { type: "personal" },
    });
  }

  it("creates, lists, edits, toggles and deletes an Item", async () => {
    const alice = await makeUser();
    const cookie = await login(alice);
    const list = await makeList(alice);

    // create
    const created = await req(
      `/api/lists/${list.id}/items`,
      cookie,
      { method: "POST", body: JSON.stringify({ title: "Milk" }) },
    );
    expect(created.status).toBe(201);
    const item = await created.json();
    expect(item.title).toBe("Milk");
    expect(item.completed).toBe(0);

    // list
    const listed = await req(`/api/lists/${list.id}/items`, cookie);
    expect((await listed.json()).map((i: { id: string }) => i.id)).toEqual([
      item.id,
    ]);

    // toggle complete
    const toggled = await req(
      `/api/lists/${list.id}/items/${item.id}`,
      cookie,
      { method: "PATCH", body: JSON.stringify({ completed: true }) },
    );
    expect((await toggled.json()).completed).toBe(1);

    // rename
    const renamed = await req(
      `/api/lists/${list.id}/items/${item.id}`,
      cookie,
      { method: "PATCH", body: JSON.stringify({ title: "Oat milk" }) },
    );
    expect((await renamed.json()).title).toBe("Oat milk");

    // delete
    const del = await req(`/api/lists/${list.id}/items/${item.id}`, cookie, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);
    expect(await db.select().from(schema.items).all()).toEqual([]);
  });

  it("sets and clears a due time", async () => {
    const alice = await makeUser();
    const cookie = await login(alice);
    const list = await makeList(alice);
    const due = { at: "2026-06-09T15:30:00.000Z", timezone: "Europe/Copenhagen" };

    const created = await req(`/api/lists/${list.id}/items`, cookie, {
      method: "POST",
      body: JSON.stringify({ title: "Dentist", due }),
    });
    const item = await created.json();
    expect(item.dueAt).toBe(due.at);
    expect(item.dueTimezone).toBe(due.timezone);

    const cleared = await req(
      `/api/lists/${list.id}/items/${item.id}`,
      cookie,
      { method: "PATCH", body: JSON.stringify({ due: null }) },
    );
    const after = await cleared.json();
    expect(after.dueAt).toBeNull();
    expect(after.dueTimezone).toBeNull();
  });

  it("rejects a blank title (400) and a partial due (400)", async () => {
    const alice = await makeUser();
    const cookie = await login(alice);
    const list = await makeList(alice);

    expect(
      (
        await req(`/api/lists/${list.id}/items`, cookie, {
          method: "POST",
          body: JSON.stringify({ title: "   " }),
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await req(`/api/lists/${list.id}/items`, cookie, {
          method: "POST",
          body: JSON.stringify({ title: "x", due: { at: "2026-01-01T00:00:00Z" } }),
        })
      ).status,
    ).toBe(400);
  });

  it("a PATCH with nothing to update is 400", async () => {
    const alice = await makeUser();
    const cookie = await login(alice);
    const list = await makeList(alice);
    const item = await (
      await req(`/api/lists/${list.id}/items`, cookie, {
        method: "POST",
        body: JSON.stringify({ title: "x" }),
      })
    ).json();

    const res = await req(`/api/lists/${list.id}/items/${item.id}`, cookie, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("creating an Item in an invisible List is 404", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await makeList(alice);

    const res = await req(`/api/lists/${list.id}/items`, await login(bob), {
      method: "POST",
      body: JSON.stringify({ title: "Sneaky" }),
    });
    expect(res.status).toBe(404);
  });

  it("editing another user's Item is 404", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await makeList(alice);
    const item = await (
      await req(`/api/lists/${list.id}/items`, await login(alice), {
        method: "POST",
        body: JSON.stringify({ title: "Milk" }),
      })
    ).json();

    const res = await req(
      `/api/lists/${list.id}/items/${item.id}`,
      await login(bob),
      { method: "PATCH", body: JSON.stringify({ title: "Hijack" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("schedules router (list / create / delete)", () => {
  const GYM = {
    title: "Gymnastics",
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    dtstart: "2026-06-02T15:30:00.000Z",
    timezone: "Europe/Copenhagen",
  };

  it("creates a Schedule in a visible List (201) and lists it", async () => {
    const alice = await makeUser();
    const cookie = await login(alice);
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });

    const created = await req(
      `/api/lists/${list.id}/schedules`,
      cookie,
      { method: "POST", body: JSON.stringify(GYM) },
    );
    expect(created.status).toBe(201);
    const schedule = await created.json();
    expect(schedule.title).toBe("Gymnastics");

    const listed = await req(`/api/lists/${list.id}/schedules`, cookie);
    expect(
      (await listed.json()).map((s: { id: string }) => s.id),
    ).toEqual([schedule.id]);
  });

  it("rejects an invalid RRULE (400)", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const res = await req(
      `/api/lists/${list.id}/schedules`,
      await login(alice),
      { method: "POST", body: JSON.stringify({ ...GYM, rrule: "NOPE" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing fields (400)", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const res = await req(
      `/api/lists/${list.id}/schedules`,
      await login(alice),
      { method: "POST", body: JSON.stringify({ title: "x" }) },
    );
    expect(res.status).toBe(400);
  });

  it("creating in an invisible List is 404", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const res = await req(
      `/api/lists/${list.id}/schedules`,
      await login(bob),
      { method: "POST", body: JSON.stringify(GYM) },
    );
    expect(res.status).toBe(404);
  });

  it("deletes a Schedule (204); another user's is 404", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const list = await createList(db, alice, {
      name: "Kids",
      owner: { type: "personal" },
    });
    const schedule = await createSchedule(db, alice, list.id, GYM);

    expect(
      (
        await req(`/api/lists/${list.id}/schedules/${schedule!.id}`, await login(bob), {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    const gone = await req(
      `/api/lists/${list.id}/schedules/${schedule!.id}`,
      await login(alice),
      { method: "DELETE" },
    );
    expect(gone.status).toBe(204);
    expect(await db.select().from(schema.schedules).all()).toEqual([]);
  });
});

describe("POST /api/schedules/:id/occurrences (one-off edits)", () => {
  const GYM = {
    title: "Gymnastics",
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    dtstart: "2026-06-02T15:30:00.000Z",
    timezone: "Europe/Copenhagen",
  };
  const target = "2026-06-09T15:30:00.000Z";

  async function makeSchedule(userId: string) {
    const list = await createList(db, userId, {
      name: "Kids",
      owner: { type: "personal" },
    });
    return createSchedule(db, userId, list.id, GYM);
  }

  it("retitles and reschedules one Occurrence, returning the effective state", async () => {
    const alice = await makeUser();
    const s = await makeSchedule(alice);
    const movedTo = "2026-06-10T18:00:00.000Z";

    const res = await req(
      `/api/schedules/${s!.id}/occurrences`,
      await login(alice),
      {
        method: "POST",
        body: JSON.stringify({
          occurrenceAt: target,
          overrideTitle: "Recital",
          overrideAt: movedTo,
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      occurrenceAt: target,
      title: "Recital",
      overrideAt: movedTo,
    });
  });

  it("rejects a malformed overrideAt with 400", async () => {
    const alice = await makeUser();
    const s = await makeSchedule(alice);

    const res = await req(
      `/api/schedules/${s!.id}/occurrences`,
      await login(alice),
      {
        method: "POST",
        body: JSON.stringify({ occurrenceAt: target, overrideAt: "nonsense" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("hides the Schedule from a non-member with 404", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const s = await makeSchedule(alice);

    const res = await req(
      `/api/schedules/${s!.id}/occurrences`,
      await login(carol),
      {
        method: "POST",
        body: JSON.stringify({ occurrenceAt: target, overrideTitle: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/invites/:secret/accept", () => {
  it("joins via a valid secret", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const invite = await generateInvite(db, alice, fam.id);

    const res = await req(
      `/api/invites/${invite.secret}/accept`,
      await login(bob),
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "joined", familyId: fam.id });
  });

  it("returns 404 for an invalid secret", async () => {
    const bob = await makeUser();
    const res = await req("/api/invites/nope/accept", await login(bob), {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("returns 410 for an expired invite", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const fam = await createFamily(db, alice, "Fam");
    const invite = await generateInvite(db, alice, fam.id);
    await db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .run();

    const res = await req(
      `/api/invites/${invite.secret}/accept`,
      await login(bob),
      { method: "POST" },
    );
    expect(res.status).toBe(410);
  });
});
