import { eq } from "drizzle-orm";
import { sha256 } from "@oslojs/crypto/sha2";
import {
  encodeBase32LowerCaseNoPadding,
  encodeHexLowerCase,
} from "@oslojs/encoding";
import { sessions, users } from "../db/schema.ts";
import type { Db } from "../db/index.ts";

export type SessionUser = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

// Sessions live in D1 (ADR-0008). The cookie carries a random token; the table
// stores only its SHA-256 hash as the primary key. Validation hashes the cookie
// value and looks it up, so the stored data is useless if leaked.

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
// Refresh the expiry when a session is within this window of expiring, so active
// users stay logged in without rewriting the row on every request.
const SESSION_REFRESH_MS = 1000 * 60 * 60 * 24 * 15; // 15 days

/** A fresh, unguessable session token to put in the cookie (never stored raw). */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

/** The stored session id = SHA-256(token) in lowercase hex. */
export function hashToken(token: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

/** Persist a new session for `userId`, returning its row. */
export async function createSession(
  db: Db,
  token: string,
  userId: string,
): Promise<Session> {
  const now = Date.now();
  const row = await db
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    })
    .returning()
    .get();
  return row;
}

export type SessionValidation =
  | { session: Session; user: SessionUser }
  | { session: null; user: null };

/**
 * Validate a cookie token: look up by hash, reject/expire if past TTL, and slide
 * the expiry when inside the refresh window. Returns the session + its User.
 */
export async function validateSessionToken(
  db: Db,
  token: string,
): Promise<SessionValidation> {
  const id = hashToken(token);
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .get();

  if (!row) return { session: null, user: null };

  const { session, user } = row;
  const expiresAt = new Date(session.expiresAt).getTime();
  const now = Date.now();

  if (now >= expiresAt) {
    await db.delete(sessions).where(eq(sessions.id, id)).run();
    return { session: null, user: null };
  }

  if (now >= expiresAt - SESSION_REFRESH_MS) {
    const newExpiry = new Date(now + SESSION_TTL_MS).toISOString();
    await db
      .update(sessions)
      .set({ expiresAt: newExpiry })
      .where(eq(sessions.id, id))
      .run();
    session.expiresAt = newExpiry;
  }

  return { session, user };
}

/** Revoke a single session by its cookie token. */
export async function invalidateSession(
  db: Db,
  token: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}

/** Revoke every session for a User (e.g. "log out everywhere"). */
export async function invalidateUserSessions(
  db: Db,
  userId: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId)).run();
}
