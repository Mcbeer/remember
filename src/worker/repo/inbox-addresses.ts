import { eq } from "drizzle-orm";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { inboxAddresses } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { uuidv7 } from "../db/id.ts";
import { getVisibleList } from "./lists.ts";

export type InboxAddress = typeof inboxAddresses.$inferSelect;

// A short random local-part. Unguessable possession is the authorisation
// (ADR-0005), mirroring the Invite secret. base32 lower-case is email-safe.
function newSecret(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

/**
 * The List's current inbound address, or null if none minted yet (or the List
 * is not visible to the User). Read-scoped through the visibility spine.
 */
export async function getInboxAddress(
  db: Db,
  userId: string,
  listId: string,
): Promise<InboxAddress | null> {
  const list = await getVisibleList(db, userId, listId);
  if (!list) return null;

  const row = await db
    .select()
    .from(inboxAddresses)
    .where(eq(inboxAddresses.listId, listId))
    .get();
  return row ?? null;
}

/**
 * Mint (or regenerate) the List's single inbound address. Regenerating replaces
 * the row, so the previous secret stops working immediately (schema enforces one
 * address per List). Returns null if the List is not visible to the User.
 */
export async function generateInboxAddress(
  db: Db,
  userId: string,
  listId: string,
): Promise<InboxAddress | null> {
  const list = await getVisibleList(db, userId, listId);
  if (!list) return null;

  const values = {
    id: uuidv7(),
    listId,
    secret: newSecret(),
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };

  // Replace any existing address for this List (UNIQUE list_id).
  const row = await db
    .insert(inboxAddresses)
    .values(values)
    .onConflictDoUpdate({
      target: inboxAddresses.listId,
      set: {
        id: values.id,
        secret: values.secret,
        createdBy: values.createdBy,
        createdAt: values.createdAt,
      },
    })
    .returning()
    .get();
  return row;
}

/**
 * Resolve an inbound address secret to its List id, without any User scoping —
 * the secret IS the capability (ADR-0005). Used by the Email Worker, which has
 * no authenticated User. Returns null for an unknown secret.
 */
export async function resolveListBySecret(
  db: Db,
  secret: string,
): Promise<string | null> {
  const row = await db
    .select({ listId: inboxAddresses.listId })
    .from(inboxAddresses)
    .where(eq(inboxAddresses.secret, secret))
    .get();
  return row?.listId ?? null;
}
