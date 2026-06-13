// Typed client for the same-origin JSON API. Cookies (the session) ride along
// automatically since we're same-origin, so no auth headers are needed.

export type Me = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

export type List = {
  id: string;
  name: string;
  ownerUserId: string | null;
  ownerFamilyId: string | null;
  familyName: string | null;
  createdAt: string;
};

export type Family = {
  id: string;
  name: string;
  createdAt: string;
};

export type Invite = { secret: string; expiresAt: string };

export type FamilyMember = {
  userId: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  joinedAt: string;
};

// A due moment: a UTC instant plus the IANA timezone it was entered in.
export type Due = { at: string; timezone: string };

export type AcceptResult =
  | { status: "joined" | "already_member"; familyId: string };

export type Item = {
  id: string;
  listId: string;
  title: string;
  completed: number; // 0 | 1
  dueAt: string | null;
  dueTimezone: string | null;
  origin: "user" | "ingested";
  status: "active" | "pending";
  createdBy: string | null;
  createdAt: string;
};

export type Schedule = {
  id: string;
  listId: string;
  title: string;
  rrule: string;
  dtstart: string;
  timezone: string;
  createdBy: string | null;
  createdAt: string;
};

export type Occurrence = {
  scheduleId: string;
  occurrenceAt: string; // canonical instant from the rule (its identity)
  title: string; // override title, else the Schedule's title
  completed: boolean;
  skipped: boolean;
  overrideAt: string | null; // rescheduled-to instant, or null if on schedule
};

// One-off edits to a single Occurrence. completed/skipped are plain flags;
// overrideTitle/overrideAt are tri-state — omit to leave unchanged, null to
// clear back to the Schedule's default.
export type OccurrenceState = {
  completed?: boolean;
  skipped?: boolean;
  overrideTitle?: string | null;
  overrideAt?: string | null;
};

// A Reminder: a Web Push fired offsetMinutes before an Item's due time or a
// Schedule's next Occurrence. Shared like its anchor.
export type Reminder = {
  id: string;
  itemId: string | null;
  scheduleId: string | null;
  offsetMinutes: number;
  lastSentAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>("/api/me"),

  families: {
    list: () => request<Family[]>("/api/families"),
    members: (familyId: string) =>
      request<FamilyMember[]>(`/api/families/${familyId}/members`),
    create: (name: string) =>
      request<Family>("/api/families", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    invite: (familyId: string) =>
      request<Invite>(`/api/families/${familyId}/invite`, { method: "POST" }),
    leave: (familyId: string) =>
      request<{ left: boolean; familyDeleted: boolean }>(
        `/api/families/${familyId}/leave`,
        { method: "POST" },
      ),
  },

  invites: {
    accept: (secret: string) =>
      request<AcceptResult>(`/api/invites/${secret}/accept`, {
        method: "POST",
      }),
  },

  lists: {
    list: () => request<List[]>("/api/lists"),
    create: (name: string, familyId?: string) =>
      request<List>("/api/lists", {
        method: "POST",
        body: JSON.stringify(familyId ? { name, familyId } : { name }),
      }),
    rename: (id: string, name: string) =>
      request<List>(`/api/lists/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    remove: (id: string) =>
      request<void>(`/api/lists/${id}`, { method: "DELETE" }),
  },

  items: {
    list: (listId: string) =>
      request<Item[]>(`/api/lists/${listId}/items`),
    create: (listId: string, title: string, due?: Due) =>
      request<Item>(`/api/lists/${listId}/items`, {
        method: "POST",
        body: JSON.stringify(due ? { title, due } : { title }),
      }),
    setCompleted: (listId: string, itemId: string, completed: boolean) =>
      request<Item>(`/api/lists/${listId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ completed }),
      }),
    edit: (
      listId: string,
      itemId: string,
      patch: { title?: string; due?: Due | null },
    ) =>
      request<Item>(`/api/lists/${listId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    remove: (listId: string, itemId: string) =>
      request<void>(`/api/lists/${listId}/items/${itemId}`, {
        method: "DELETE",
      }),
  },

  schedules: {
    list: (listId: string) =>
      request<Schedule[]>(`/api/lists/${listId}/schedules`),
    create: (
      listId: string,
      input: { title: string; rrule: string; dtstart: string; timezone: string },
    ) =>
      request<Schedule>(`/api/lists/${listId}/schedules`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    remove: (listId: string, scheduleId: string) =>
      request<void>(`/api/lists/${listId}/schedules/${scheduleId}`, {
        method: "DELETE",
      }),
    occurrences: (scheduleId: string) =>
      request<Occurrence[]>(`/api/schedules/${scheduleId}/occurrences`),
    setOccurrence: (
      scheduleId: string,
      occurrenceAt: string,
      state: OccurrenceState,
    ) =>
      request<Occurrence>(`/api/schedules/${scheduleId}/occurrences`, {
        method: "POST",
        body: JSON.stringify({ occurrenceAt, ...state }),
      }),
  },

  reminders: {
    forItem: (listId: string, itemId: string) =>
      request<Reminder[]>(`/api/lists/${listId}/items/${itemId}/reminders`),
    addToItem: (listId: string, itemId: string, offsetMinutes: number) =>
      request<Reminder>(`/api/lists/${listId}/items/${itemId}/reminders`, {
        method: "POST",
        body: JSON.stringify({ offsetMinutes }),
      }),
    forSchedule: (listId: string, scheduleId: string) =>
      request<Reminder[]>(
        `/api/lists/${listId}/schedules/${scheduleId}/reminders`,
      ),
    addToSchedule: (listId: string, scheduleId: string, offsetMinutes: number) =>
      request<Reminder>(
        `/api/lists/${listId}/schedules/${scheduleId}/reminders`,
        { method: "POST", body: JSON.stringify({ offsetMinutes }) },
      ),
    remove: (reminderId: string) =>
      request<void>(`/api/reminders/${reminderId}`, { method: "DELETE" }),
  },

  push: {
    // The VAPID public key the browser needs to subscribe (open endpoint).
    key: () => request<{ publicKey: string }>("/api/push/key"),
    subscribe: (sub: PushSubscriptionJSON) =>
      request<{ id: string }>("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(sub),
      }),
    unsubscribe: (endpoint: string) =>
      request<void>("/api/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      }),
  },
};

export { ApiError };
