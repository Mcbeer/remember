// Email Ingestion: turn an inbound email into suggested Item(s) (ADR-0005).
//
// The extractor is a small, swappable interface so the Email Worker, the tests,
// and any future model change all depend on the shape, not on Workers AI
// directly. The real implementation calls an on-platform LLM (Workers AI); tests
// inject a deterministic fake. Extraction is best-effort and untrusted — every
// result becomes a *pending* Item a Member must confirm, so a wrong title or
// date is a cheap mistake, never a silent write into the real list.

// The raw inbound email, reduced to what the extractor needs.
export type IncomingEmail = {
  subject: string;
  text: string; // plain-text body (HTML stripped upstream)
  receivedAt: Date; // anchor for resolving relative dates ("tomorrow")
};

// One suggested Item. `due` is optional; when present it is a UTC instant plus
// the IANA timezone the model resolved it in (kept as a pair, like Item.due).
export type ExtractedItem = {
  title: string;
  due?: { at: string; timezone: string };
};

// The contract the Email Worker depends on. Returns zero or more suggestions;
// returning [] (nothing actionable found) is valid and means "ingest nothing".
export interface ItemExtractor {
  extract(email: IncomingEmail): Promise<ExtractedItem[]>;
}

// The model we ask. Small + fast + free-tier friendly; the task (pull a few
// short todos out of an email) does not need a large model. (The older
// llama-3.1-8b-instruct was deprecated 2026-05-30 — see AiError 5028.)
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT = `You extract to-do items from an email.
Return ONLY a JSON array (no prose, no markdown fences). Each element:
  { "title": string, "dueAt"?: string }
- title: a short imperative task ("Buy milk", "Pay school trip fee"). Required.
- dueAt: an ISO-8601 UTC instant (e.g. "2026-06-20T15:00:00.000Z") if and only
  if the email states a clear date/time. Omit it otherwise. Never invent one.
If the email contains no actionable task, return [].
Extract at most 10 items.`;

// Defensive parse of the model output. Workers AI may return `response` as a
// JSON string (sometimes wrapped in prose or ```fences), OR — depending on the
// model — as an already-parsed array/object. We normalise both: if it's a
// string we extract the first JSON array substring and parse it; if it's already
// an array we use it directly. Anything malformed is dropped, not thrown — a bad
// model response should yield zero suggestions, not a 500 in the email pipeline.
export function parseExtraction(
  raw: unknown,
  timezone: string,
): ExtractedItem[] {
  let parsed: unknown;

  if (Array.isArray(raw)) {
    // Already-parsed array from the AI binding.
    parsed = raw;
  } else if (typeof raw === "string") {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) return [];
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return [];
    }
  } else {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const out: ExtractedItem[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title) continue;

    const item: ExtractedItem = { title: title.slice(0, 500) };
    if (typeof e.dueAt === "string") {
      const t = new Date(e.dueAt);
      if (!Number.isNaN(t.getTime())) {
        item.due = { at: t.toISOString(), timezone };
      }
    }
    out.push(item);
    if (out.length >= 10) break;
  }
  return out;
}

// The production extractor backed by Workers AI. `timezone` is the IANA zone we
// attribute any resolved due time to (the List/Family's zone in a fuller build;
// for now a sensible default passed by the Worker).
export function createAiExtractor(
  ai: Ai,
  timezone = "UTC",
): ItemExtractor {
  return {
    async extract(email: IncomingEmail): Promise<ExtractedItem[]> {
      const userContent = [
        `Today is ${email.receivedAt.toISOString()} (resolve relative dates against this).`,
        `Subject: ${email.subject}`,
        "",
        email.text.slice(0, 8000),
      ].join("\n");

      const res = (await ai.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      })) as { response?: unknown };

      return parseExtraction(res.response ?? "", timezone);
    },
  };
}
