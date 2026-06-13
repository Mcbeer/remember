// The Email Worker leg of Email Ingestion (ADR-0005). Cloudflare Email Routing
// delivers an inbound message here; we resolve the target List from the
// recipient's local-part secret, ask the extractor for suggested Items, and
// write them as pending. No authenticated User is involved — possession of the
// secret address IS the authorisation.

import PostalMime from "postal-mime";
import type { Db } from "../db/index.ts";
import { resolveListBySecret } from "../repo/inbox-addresses.ts";
import { createIngestedItem } from "../repo/items.ts";
import type { IncomingEmail, ItemExtractor } from "./extract.ts";

// Pull the local-part secret from an address like `groceries-a8f3@inbox.ex.com`.
// The secret is everything before the first '@'. A '+suffix' (sub-addressing) is
// stripped so `secret+anything@...` still resolves. Returns "" if malformed.
export function localPartOf(address: string): string {
  const at = address.indexOf("@");
  const local = at === -1 ? address : address.slice(0, at);
  const plus = local.indexOf("+");
  return (plus === -1 ? local : local.slice(0, plus)).trim().toLowerCase();
}

// The subset of a parsed email we shape into IncomingEmail. postal-mime returns
// a richer object; this is the part we depend on (and what tests can fake).
export type ParsedEmail = {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
};

// Shape a parsed email into the reduced form the extractor needs. Prefer the
// plain-text part; fall back to HTML with tags stripped. Pure + synchronous so
// it can be unit-tested without raw MIME or the postal-mime dependency.
export function toIncomingEmail(
  parsed: ParsedEmail,
  receivedAt: Date,
): IncomingEmail {
  const subject = (parsed.subject ?? "").trim();
  let text = (parsed.text ?? "").trim();
  if (!text && parsed.html) {
    text = parsed.html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { subject, text, receivedAt };
}

// Parse a raw RFC 822 message (full MIME, multipart, encodings) into the reduced
// shape via postal-mime — the parser Cloudflare recommends for Email Workers.
export async function parseIncoming(
  raw: string | ReadableStream,
  receivedAt: Date,
): Promise<IncomingEmail> {
  const parsed = await PostalMime.parse(raw);
  return toIncomingEmail(parsed, receivedAt);
}

export type IngestResult =
  | { status: "ingested"; listId: string; count: number }
  | { status: "unknown_address" }
  | { status: "nothing_extracted"; listId: string };

// The pure orchestration: given the resolved DB + extractor + parsed email and
// the recipient address, resolve the List, extract, and write pending Items.
// Returns a result describing what happened (useful for logging and tests).
export async function ingestEmail(
  db: Db,
  extractor: ItemExtractor,
  recipient: string,
  email: IncomingEmail,
): Promise<IngestResult> {
  const secret = localPartOf(recipient);
  const listId = await resolveListBySecret(db, secret);
  if (!listId) return { status: "unknown_address" };

  const extracted = await extractor.extract(email);
  if (extracted.length === 0) return { status: "nothing_extracted", listId };

  for (const item of extracted) {
    await createIngestedItem(db, listId, {
      title: item.title,
      due: item.due,
    });
  }

  return { status: "ingested", listId, count: extracted.length };
}
