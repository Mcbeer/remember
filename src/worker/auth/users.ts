import { and, eq } from "drizzle-orm";
import { oauthIdentities, users } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";

// Thrown when a login cannot proceed safely — e.g. the provider's email is
// unverified but already belongs to an existing User, so we can neither link
// (hijack risk) nor create a duplicate (users.email is UNIQUE). The callback
// turns this into a friendly redirect rather than a 500.
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "email_unverified_conflict",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type OAuthProfile = {
  provider: string; // 'google' | 'github' | ...
  providerUserId: string; // stable subject id from the provider
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
};

export type User = typeof users.$inferSelect;

/**
 * Resolve a User for an OAuth login, creating/linking as needed (ADR-0001):
 *
 *  1. Known (provider, subject) -> that User.
 *  2. Else, if the provider VERIFIED the email and a User with that email
 *     exists -> link a new identity to that User (one person = one User).
 *  3. Else -> create a new User and identity.
 *
 * We only link by email when the provider asserts it is verified; otherwise a
 * spoofed unverified email could hijack an existing account.
 */
export async function upsertUserFromOAuth(
  db: Db,
  profile: OAuthProfile,
): Promise<User> {
  // 1. Existing identity for this provider subject.
  const existingIdentity = await db
    .select({ userId: oauthIdentities.userId })
    .from(oauthIdentities)
    .where(
      and(
        eq(oauthIdentities.provider, profile.provider),
        eq(oauthIdentities.providerUserId, profile.providerUserId),
      ),
    )
    .get();

  if (existingIdentity) {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, existingIdentity.userId))
      .get();
    if (user) return user;
  }

  const now = new Date().toISOString();

  // Is the email already owned by some User?
  const byEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .get();

  if (byEmail) {
    // 2a. Verified email -> link a new identity to the existing User.
    if (profile.emailVerified) {
      await db
        .insert(oauthIdentities)
        .values({
          id: uuidv7(),
          userId: byEmail.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          createdAt: now,
        })
        .run();
      return byEmail;
    }
    // 2b. Unverified email that already belongs to someone: refuse. Linking
    // would be a hijack; creating a second User violates the UNIQUE email.
    throw new AuthError(
      "Email is unverified and already in use",
      "email_unverified_conflict",
    );
  }

  // 3. New User + identity (email not yet known).
  const userId = uuidv7();
  const user = await db
    .insert(users)
    .values({
      id: userId,
      email: profile.email,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      createdAt: now,
    })
    .returning()
    .get();

  await db
    .insert(oauthIdentities)
    .values({
      id: uuidv7(),
      userId,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      createdAt: now,
    })
    .run();

  return user;
}
