import { and, eq } from "drizzle-orm";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { invites, memberships } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";
import { isFamilyMember } from "./visibility.ts";
import { AuthorizationError } from "./errors.ts";

export type Invite = typeof invites.$inferSelect;

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function newSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

/**
 * Generate (or regenerate) the Family's single Invite. Regenerating replaces the
 * row, so the previous secret stops working immediately (schema enforces one
 * Invite per Family). Only a Member may do this.
 */
export async function generateInvite(
  db: Db,
  userId: string,
  familyId: string,
): Promise<Invite> {
  if (!(await isFamilyMember(db, userId, familyId))) {
    throw new AuthorizationError("Not a member of this Family");
  }

  const now = Date.now();
  const values = {
    id: uuidv7(),
    familyId,
    secret: newSecret(),
    createdBy: userId,
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    createdAt: new Date(now).toISOString(),
  };

  // Replace any existing Invite for this Family (UNIQUE family_id).
  const existing = await db
    .insert(invites)
    .values(values)
    .onConflictDoUpdate({
      target: invites.familyId,
      set: {
        id: values.id,
        secret: values.secret,
        createdBy: values.createdBy,
        expiresAt: values.expiresAt,
        createdAt: values.createdAt,
      },
    })
    .returning()
    .get();

  return existing;
}

export type AcceptResult =
  | { status: "joined" | "already_member"; familyId: string }
  | { status: "invalid" | "expired" };

/**
 * Accept an Invite by its secret: create a Membership for the User in the
 * Invite's Family. Idempotent — re-accepting when already a Member is fine.
 */
export async function acceptInvite(
  db: Db,
  userId: string,
  secret: string,
): Promise<AcceptResult> {
  const invite = await db
    .select()
    .from(invites)
    .where(eq(invites.secret, secret))
    .get();

  if (!invite) return { status: "invalid" };
  if (Date.now() >= new Date(invite.expiresAt).getTime()) {
    return { status: "expired" };
  }

  const already = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.familyId, invite.familyId),
      ),
    )
    .get();

  if (already) {
    return { status: "already_member", familyId: invite.familyId };
  }

  await db
    .insert(memberships)
    .values({
      id: uuidv7(),
      userId,
      familyId: invite.familyId,
      createdAt: new Date().toISOString(),
    })
    .run();

  return { status: "joined", familyId: invite.familyId };
}
