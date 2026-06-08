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
  occurrenceAt: string;
  title: string;
  completed: boolean;
  skipped: boolean;
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
      state: { completed?: boolean; skipped?: boolean },
    ) =>
      request<Occurrence>(`/api/schedules/${scheduleId}/occurrences`, {
        method: "POST",
        body: JSON.stringify({ occurrenceAt, ...state }),
      }),
  },
};

export { ApiError };
