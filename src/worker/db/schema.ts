import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";

// Domain: see CONTEXT.md. Decisions: docs/adr/0001-0006.
//
// Conventions:
//   * Primary keys are UUIDv7 text (time-ordered, unguessable), set in app code.
//   * Timestamps are TEXT ISO-8601 UTC ("2026-06-07T17:30:00.000Z").
//   * Booleans are INTEGER 0/1 (SQLite has no boolean type).
//   * FKs: ON DELETE CASCADE for ownership, SET NULL for authorship.

// A User: an authenticated person identified by an OAuth login.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull(),
});

// An OAuth identity belonging to a User. A User may link several providers
// (same person via Google and GitHub) to one account.
export const oauthIdentities = sqliteTable(
  "oauth_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'google' | 'github' | ...
    providerUserId: text("provider_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_oauth_provider_subject").on(t.provider, t.providerUserId),
    index("idx_oauth_identities_user").on(t.userId),
  ],
);

// A Session: a server-side login session for a User (ADR-0008). The cookie holds
// a random token; we store only its SHA-256 hash here, so a DB leak does not
// expose usable tokens. Deleting the row (or letting it expire) revokes access.
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // SHA-256 hash (hex) of the cookie token
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(), // ISO-8601 UTC
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

// A Family: a group of Users who share one or more Lists.
export const families = sqliteTable("families", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

// A Membership: the link between a User and a Family. All Memberships are equal
// (no roles).
export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_membership_user_family").on(t.userId, t.familyId),
    index("idx_memberships_user").on(t.userId),
    index("idx_memberships_family").on(t.familyId),
  ],
);

// An Invite: a reusable, expiring secret that lets a User join a Family.
// Regenerating replaces the row (at most one live Invite per Family).
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .unique()
      .references(() => families.id, { onDelete: "cascade" }),
    secret: text("secret").notNull().unique(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_invites_secret").on(t.secret)],
);

// A List: owned by EITHER one User (personal) or one Family (shared).
// Ownership is the only sharing axis (ADR-0002). CHECK enforces exactly one owner.
export const lists = sqliteTable(
  "lists",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    ownerFamilyId: text("owner_family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_lists_owner_user").on(t.ownerUserId),
    index("idx_lists_owner_family").on(t.ownerFamilyId),
    check(
      "ck_lists_exactly_one_owner",
      sql`(${t.ownerUserId} IS NOT NULL AND ${t.ownerFamilyId} IS NULL) OR (${t.ownerUserId} IS NULL AND ${t.ownerFamilyId} IS NOT NULL)`,
    ),
  ],
);

// An Item: a single completable thing belonging to exactly one List.
// origin: 'user' or 'ingested' (Email Ingestion, ADR-0005).
// status: 'active' or 'pending' (suggested, awaiting confirmation).
// Due time = UTC instant + IANA timezone it was entered in (DST-safe reminders).
export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: integer("completed").notNull().default(0),
    dueAt: text("due_at"),
    dueTimezone: text("due_timezone"),
    origin: text("origin", { enum: ["user", "ingested"] })
      .notNull()
      .default("user"),
    status: text("status", { enum: ["active", "pending"] })
      .notNull()
      .default("active"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_items_list").on(t.listId),
    index("idx_items_due").on(t.dueAt),
    check("ck_items_completed_bool", sql`${t.completed} IN (0, 1)`),
    check(
      "ck_items_due_pair",
      sql`(${t.dueAt} IS NULL) = (${t.dueTimezone} IS NULL)`,
    ),
  ],
);

// An InboxAddress: a unique secret inbound email address for a List (ADR-0005).
// The `secret` is the local-part of an address (e.g. `groceries-a8f3` in
// `groceries-a8f3@inbox.example.com`); it both routes an inbound email to this
// List and acts as the capability to write to it (possession = authorisation).
// At most one live address per List (UNIQUE list_id); regenerating replaces the
// row so the old address stops working. Items created this way enter as
// origin='ingested', status='pending' for a Member to confirm.
export const inboxAddresses = sqliteTable(
  "inbox_addresses",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .unique()
      .references(() => lists.id, { onDelete: "cascade" }),
    secret: text("secret").notNull().unique(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_inbox_addresses_secret").on(t.secret)],
);

// A Schedule: a recurrence rule belonging to a List (ADR-0004). Never completed;
// generates Occurrences. rrule = iCalendar RRULE; dtstart = UTC anchor instant.
export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rrule: text("rrule").notNull(),
    dtstart: text("dtstart").notNull(),
    timezone: text("timezone").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_schedules_list").on(t.listId)],
);

// An Occurrence: a single dated instance of a Schedule. A row exists ONLY when
// the Occurrence has its own state (completed/skipped) or a one-off edit.
export const occurrences = sqliteTable(
  "occurrences",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    occurrenceAt: text("occurrence_at").notNull(),
    completed: integer("completed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    overrideTitle: text("override_title"),
    overrideAt: text("override_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_occurrence_schedule_at").on(t.scheduleId, t.occurrenceAt),
    index("idx_occurrences_schedule").on(t.scheduleId),
    check("ck_occurrences_completed_bool", sql`${t.completed} IN (0, 1)`),
    check("ck_occurrences_skipped_bool", sql`${t.skipped} IN (0, 1)`),
  ],
);

// A push subscription: one browser/device endpoint a User has granted Web Push
// to (per-device, not per-user). The Web Push spec gives us an endpoint URL plus
// two keys (p256dh, auth) that we encrypt payloads against. A User with a phone
// and a laptop has two rows; both get pushed. Deleting the row stops delivery to
// that device. `endpoint` is unique so re-subscribing the same device upserts.
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_push_subscriptions_user").on(t.userId)],
);

// A Reminder: a Web Push fired `offsetMinutes` before a due moment — either an
// Item's due time or a Schedule's next Occurrence (CONTEXT "Reminder"). A
// Reminder is shared like the thing it attaches to: any Member can add one to a
// shared Item/Schedule, and when it fires every recipient (the owning User, or
// all Members of the owning Family) is pushed on all their devices. Exactly one
// of itemId / scheduleId is set (CHECK). `lastSentAt` is the occurrence instant
// we most recently fired for, so the cron scheduler never double-sends and a
// Schedule's reminder advances occurrence to occurrence.
export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").references(() => items.id, { onDelete: "cascade" }),
    scheduleId: text("schedule_id").references(() => schedules.id, {
      onDelete: "cascade",
    }),
    offsetMinutes: integer("offset_minutes").notNull(),
    lastSentAt: text("last_sent_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_reminders_item").on(t.itemId),
    index("idx_reminders_schedule").on(t.scheduleId),
    check(
      "ck_reminders_exactly_one_anchor",
      sql`(${t.itemId} IS NOT NULL AND ${t.scheduleId} IS NULL) OR (${t.itemId} IS NULL AND ${t.scheduleId} IS NOT NULL)`,
    ),
    check("ck_reminders_offset_nonneg", sql`${t.offsetMinutes} >= 0`),
  ],
);
