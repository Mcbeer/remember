import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, schema } from "../src/worker/db/index.ts";
import {
  generateSessionToken,
  hashToken,
  createSession,
  validateSessionToken,
  invalidateSession,
  invalidateUserSessions,
} from "../src/worker/auth/session.ts";
import {
  upsertUserFromOAuth,
  AuthError,
  type OAuthProfile,
} from "../src/worker/auth/users.ts";

const db = createDb(env.DB);

beforeEach(async () => {
  await db.delete(schema.sessions).run();
  await db.delete(schema.oauthIdentities).run();
  await db.delete(schema.users).run();
});

function googleProfile(over: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    provider: "google",
    providerUserId: "google-sub-1",
    email: "a@example.com",
    emailVerified: true,
    name: "Alice",
    ...over,
  };
}

describe("Sessions (ADR-0008)", () => {
  it("stores only the token hash, not the raw token", async () => {
    const user = await upsertUserFromOAuth(db, googleProfile());
    const token = generateSessionToken();
    const session = await createSession(db, token, user.id);

    expect(session.id).toBe(hashToken(token));
    expect(session.id).not.toBe(token);

    const stored = await db
      .select()
      .from(schema.sessions)
      .all();
    expect(stored[0].id).not.toContain(token);
  });

  it("validates a good token to its User", async () => {
    const user = await upsertUserFromOAuth(db, googleProfile());
    const token = generateSessionToken();
    await createSession(db, token, user.id);

    const result = await validateSessionToken(db, token);
    expect(result.user?.id).toBe(user.id);
  });

  it("rejects an unknown / tampered token", async () => {
    const result = await validateSessionToken(db, generateSessionToken());
    expect(result.session).toBeNull();
    expect(result.user).toBeNull();
  });

  it("rejects and deletes an expired session", async () => {
    const user = await upsertUserFromOAuth(db, googleProfile());
    const token = generateSessionToken();
    await createSession(db, token, user.id);
    // Force expiry into the past.
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .run();

    const result = await validateSessionToken(db, token);
    expect(result.session).toBeNull();
    expect(await db.select().from(schema.sessions).all()).toEqual([]);
  });

  it("invalidate removes the session", async () => {
    const user = await upsertUserFromOAuth(db, googleProfile());
    const token = generateSessionToken();
    await createSession(db, token, user.id);

    await invalidateSession(db, token);
    expect((await validateSessionToken(db, token)).session).toBeNull();
  });

  it("invalidateUserSessions logs out everywhere", async () => {
    const user = await upsertUserFromOAuth(db, googleProfile());
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    await createSession(db, t1, user.id);
    await createSession(db, t2, user.id);

    await invalidateUserSessions(db, user.id);
    expect((await validateSessionToken(db, t1)).session).toBeNull();
    expect((await validateSessionToken(db, t2)).session).toBeNull();
  });
});

describe("User upsert + account linking (ADR-0001)", () => {
  it("creates a new User + identity on first login", async () => {
    const user = await upsertUserFromOAuth(db, googleProfile());
    expect(user.email).toBe("a@example.com");
    expect(await db.select().from(schema.users).all()).toHaveLength(1);
    expect(await db.select().from(schema.oauthIdentities).all()).toHaveLength(1);
  });

  it("returns the same User on repeat login (same provider subject)", async () => {
    const first = await upsertUserFromOAuth(db, googleProfile());
    const second = await upsertUserFromOAuth(db, googleProfile());
    expect(second.id).toBe(first.id);
    expect(await db.select().from(schema.users).all()).toHaveLength(1);
  });

  it("links a second provider to the same User by VERIFIED email", async () => {
    const google = await upsertUserFromOAuth(db, googleProfile());
    const github = await upsertUserFromOAuth(
      db,
      googleProfile({
        provider: "github",
        providerUserId: "gh-1",
        emailVerified: true,
      }),
    );

    expect(github.id).toBe(google.id); // one person, one User
    expect(await db.select().from(schema.users).all()).toHaveLength(1);
    expect(await db.select().from(schema.oauthIdentities).all()).toHaveLength(2);
  });

  it("REJECTS login when email is unverified and already in use (no hijack, no dup)", async () => {
    await upsertUserFromOAuth(db, googleProfile()); // owns a@example.com

    await expect(
      upsertUserFromOAuth(
        db,
        googleProfile({
          provider: "github",
          providerUserId: "gh-2",
          emailVerified: false, // unverified -> must not link, must not collide
        }),
      ),
    ).rejects.toBeInstanceOf(AuthError);

    // Still exactly one User; nothing linked.
    expect(await db.select().from(schema.users).all()).toHaveLength(1);
    expect(await db.select().from(schema.oauthIdentities).all()).toHaveLength(1);
  });
});
