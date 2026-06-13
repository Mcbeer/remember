import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, schema } from "../src/worker/db/index.ts";
import { uuidv7 } from "../src/worker/db/id.ts";
import { createList } from "../src/worker/repo/lists.ts";
import {
  createItem,
  listItems,
  listPendingItems,
  confirmPendingItem,
  rejectPendingItem,
  createIngestedItem,
} from "../src/worker/repo/items.ts";
import {
  generateInboxAddress,
  getInboxAddress,
  resolveListBySecret,
} from "../src/worker/repo/inbox-addresses.ts";
import {
  parseExtraction,
  type IncomingEmail,
  type ItemExtractor,
} from "../src/worker/ingestion/extract.ts";
import {
  localPartOf,
  parseIncoming,
  toIncomingEmail,
  ingestEmail,
} from "../src/worker/ingestion/email.ts";

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
  await db.delete(schema.inboxAddresses).run();
  await db.delete(schema.lists).run();
  await db.delete(schema.memberships).run();
  await db.delete(schema.families).run();
  await db.delete(schema.users).run();
});

// A deterministic extractor so the ingest pipeline can be tested without
// Workers AI. It returns whatever it's constructed with.
function fakeExtractor(items: { title: string; due?: { at: string; timezone: string } }[]): ItemExtractor {
  return { extract: async () => items };
}

describe("parseExtraction (LLM output → suggestions)", () => {
  it("parses a clean JSON array", () => {
    const out = parseExtraction(
      '[{"title":"Buy milk"},{"title":"Pay fee","dueAt":"2026-06-20T15:00:00.000Z"}]',
      "Europe/Copenhagen",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: "Buy milk" });
    expect(out[1].title).toBe("Pay fee");
    expect(out[1].due).toEqual({
      at: "2026-06-20T15:00:00.000Z",
      timezone: "Europe/Copenhagen",
    });
  });

  it("pulls the array out of surrounding prose / fences", () => {
    const out = parseExtraction(
      'Sure! Here you go:\n```json\n[{"title":"Walk dog"}]\n```\nHope that helps.',
      "UTC",
    );
    expect(out).toEqual([{ title: "Walk dog" }]);
  });

  it("drops malformed entries and bad dates, never throws", () => {
    const out = parseExtraction(
      '[{"title":""},{"nope":1},{"title":"Real","dueAt":"not-a-date"}]',
      "UTC",
    );
    expect(out).toEqual([{ title: "Real" }]);
  });

  it("returns [] for non-JSON or empty output", () => {
    expect(parseExtraction("I found nothing actionable.", "UTC")).toEqual([]);
    expect(parseExtraction("", "UTC")).toEqual([]);
  });

  it("accepts an already-parsed array (some Workers AI models return this)", () => {
    // Regression: prod returned `response` as an array, not a JSON string.
    expect(
      parseExtraction([{ title: "Læs side 15 og 16 i bogen" }], "UTC"),
    ).toEqual([{ title: "Læs side 15 og 16 i bogen" }]);
  });

  it("handles non-ASCII (Danish) titles", () => {
    expect(
      parseExtraction('[{"title":"Køb mælk og æbler"}]', "UTC"),
    ).toEqual([{ title: "Køb mælk og æbler" }]);
  });

  it("caps at 10 suggestions", () => {
    const many = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ title: `t${i}` })),
    );
    expect(parseExtraction(many, "UTC")).toHaveLength(10);
  });
});

describe("localPartOf (address → secret)", () => {
  it("extracts the local-part and lowercases it", () => {
    expect(localPartOf("Groceries-A8F3@inbox.example.com")).toBe(
      "groceries-a8f3",
    );
  });
  it("strips +sub-addressing", () => {
    expect(localPartOf("sec123+anything@inbox.example.com")).toBe("sec123");
  });
});

describe("toIncomingEmail (parsed → IncomingEmail)", () => {
  it("prefers the plain-text part", () => {
    const email = toIncomingEmail(
      { subject: "Homework due", text: "Maths page 5 by Friday." },
      new Date("2026-06-13T00:00:00Z"),
    );
    expect(email.subject).toBe("Homework due");
    expect(email.text).toBe("Maths page 5 by Friday.");
  });

  it("falls back to HTML with tags stripped when no text part", () => {
    const email = toIncomingEmail(
      { subject: "Hi", html: "<html><body><p>Bring <b>cake</b></p></body></html>" },
      new Date(),
    );
    expect(email.text).toBe("Bring cake");
  });

  it("tolerates missing fields", () => {
    const email = toIncomingEmail({}, new Date());
    expect(email.subject).toBe("");
    expect(email.text).toBe("");
  });
});

describe("parseIncoming (raw MIME → IncomingEmail, via postal-mime)", () => {
  it("parses a simple raw message", async () => {
    const raw =
      "From: school@x.test\r\nSubject: Homework due\r\nContent-Type: text/plain\r\n\r\nMaths page 5 by Friday.";
    const email = await parseIncoming(raw, new Date("2026-06-13T00:00:00Z"));
    expect(email.subject).toBe("Homework due");
    expect(email.text).toContain("Maths page 5 by Friday.");
  });
});

describe("inbox addresses (ADR-0005)", () => {
  it("mints, reads back, and resolves by secret", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "Groceries",
      owner: { type: "personal" },
    });

    const minted = await generateInboxAddress(db, alice, list.id);
    expect(minted?.secret).toBeTruthy();

    const read = await getInboxAddress(db, alice, list.id);
    expect(read?.secret).toBe(minted!.secret);

    expect(await resolveListBySecret(db, minted!.secret)).toBe(list.id);
    expect(await resolveListBySecret(db, "unknown")).toBeNull();
  });

  it("regenerating replaces the secret (old stops resolving)", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    const first = await generateInboxAddress(db, alice, list.id);
    const second = await generateInboxAddress(db, alice, list.id);
    expect(second!.secret).not.toBe(first!.secret);
    expect(await db.select().from(schema.inboxAddresses).all()).toHaveLength(1);
    expect(await resolveListBySecret(db, first!.secret)).toBeNull();
    expect(await resolveListBySecret(db, second!.secret)).toBe(list.id);
  });

  it("a non-member cannot mint or read an address (visibility-scoped)", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    expect(await generateInboxAddress(db, carol, list.id)).toBeNull();
    expect(await getInboxAddress(db, carol, list.id)).toBeNull();
  });
});

describe("pending Items (review queue)", () => {
  it("ingested Items are pending and excluded from the active list", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });

    await createItem(db, alice, list.id, { title: "Real one" });
    await createIngestedItem(db, list.id, { title: "Suggested" });

    const active = await listItems(db, alice, list.id);
    expect(active.map((i) => i.title)).toEqual(["Real one"]);

    const pending = await listPendingItems(db, alice, list.id);
    expect(pending.map((i) => i.title)).toEqual(["Suggested"]);
    expect(pending[0].origin).toBe("ingested");
    expect(pending[0].status).toBe("pending");
  });

  it("confirming promotes the suggestion into the active list", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    const pendingItem = await createIngestedItem(db, list.id, {
      title: "Suggested",
    });

    const confirmed = await confirmPendingItem(db, alice, pendingItem.id);
    expect(confirmed?.status).toBe("active");

    expect((await listPendingItems(db, alice, list.id))).toHaveLength(0);
    expect((await listItems(db, alice, list.id)).map((i) => i.title)).toEqual([
      "Suggested",
    ]);
  });

  it("confirming can apply edits in the same step", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    const p = await createIngestedItem(db, list.id, { title: "buy milk" });

    const confirmed = await confirmPendingItem(db, alice, p.id, {
      title: "Buy oat milk",
      due: { at: "2026-06-20T15:00:00.000Z", timezone: "UTC" },
    });
    expect(confirmed?.title).toBe("Buy oat milk");
    expect(confirmed?.dueAt).toBe("2026-06-20T15:00:00.000Z");
  });

  it("rejecting discards a pending Item; non-pending cannot be rejected", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    const p = await createIngestedItem(db, list.id, { title: "Suggested" });
    const real = await createItem(db, alice, list.id, { title: "Real" });

    expect(await rejectPendingItem(db, alice, p.id)).toBe(true);
    expect(await listPendingItems(db, alice, list.id)).toHaveLength(0);

    // An active Item is not a pending suggestion → reject is a no-op false.
    expect(await rejectPendingItem(db, alice, real.id)).toBe(false);
    expect(await listItems(db, alice, list.id)).toHaveLength(1);
  });

  it("a non-member cannot see or confirm another's pending Items", async () => {
    const alice = await makeUser();
    const carol = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    const p = await createIngestedItem(db, list.id, { title: "Secret" });

    expect(await listPendingItems(db, carol, list.id)).toEqual([]);
    expect(await confirmPendingItem(db, carol, p.id)).toBeNull();
    expect(await rejectPendingItem(db, carol, p.id)).toBe(false);
  });
});

describe("ingestEmail (orchestration, ADR-0005)", () => {
  const email: IncomingEmail = {
    subject: "From school",
    text: "Homework due Friday",
    receivedAt: new Date("2026-06-13T00:00:00Z"),
  };

  it("routes to the List by secret and writes pending Items", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    const addr = await generateInboxAddress(db, alice, list.id);

    const result = await ingestEmail(
      db,
      fakeExtractor([{ title: "Maths p5" }, { title: "Bring PE kit" }]),
      `${addr!.secret}@inbox.example.com`,
      email,
    );
    expect(result).toEqual({
      status: "ingested",
      listId: list.id,
      count: 2,
    });
    expect((await listPendingItems(db, alice, list.id)).map((i) => i.title)).toEqual([
      "Maths p5",
      "Bring PE kit",
    ]);
  });

  it("rejects an unknown address without writing", async () => {
    const result = await ingestEmail(
      db,
      fakeExtractor([{ title: "x" }]),
      "nobody@inbox.example.com",
      email,
    );
    expect(result).toEqual({ status: "unknown_address" });
    expect(await db.select().from(schema.items).all()).toHaveLength(0);
  });

  it("reports nothing_extracted when the extractor finds nothing", async () => {
    const alice = await makeUser();
    const list = await createList(db, alice, {
      name: "L",
      owner: { type: "personal" },
    });
    const addr = await generateInboxAddress(db, alice, list.id);

    const result = await ingestEmail(
      db,
      fakeExtractor([]),
      `${addr!.secret}@inbox.example.com`,
      email,
    );
    expect(result).toEqual({ status: "nothing_extracted", listId: list.id });
    expect(await db.select().from(schema.items).all()).toHaveLength(0);
  });
});
