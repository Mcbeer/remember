import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  api,
  ApiError,
  type Item,
  type List,
  type Family,
  type Due,
  type Occurrence,
  type OccurrenceState,
  type Reminder,
  type InboxAddress,
} from "./api.ts";

// Current User. 401 (not logged in) is a normal state, not an error to retry.
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: (_count, err) =>
      !(err instanceof ApiError && err.status === 401),
  });
}

export function useLists() {
  return useQuery({ queryKey: ["lists"], queryFn: api.lists.list });
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; familyId?: string }) =>
      api.lists.create(args.name, args.familyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useFamilies() {
  return useQuery({ queryKey: ["families"], queryFn: api.families.list });
}

export function useFamilyMembers(familyId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["familyMembers", familyId],
    queryFn: () => api.families.members(familyId!),
    enabled: !!familyId && enabled,
  });
}

export function useCreateFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.families.create(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["families"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useLeaveFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (familyId: string) => api.families.leave(familyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["families"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useGenerateInvite() {
  return useMutation({
    mutationFn: (familyId: string) => api.families.invite(familyId),
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (secret: string) => api.invites.accept(secret),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["families"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.lists.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useItems(listId: string | null) {
  return useQuery({
    queryKey: ["items", listId],
    queryFn: () => api.items.list(listId!),
    enabled: !!listId,
  });
}

export function useCreateItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { title: string; due?: Due }) =>
      api.items.create(listId, args.title, args.due),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items", listId] }),
  });
}

export function useEditItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      itemId: string;
      patch: { title?: string; due?: Due | null };
    }) => api.items.edit(listId, args.itemId, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items", listId] }),
  });
}

export function useToggleItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: Item) =>
      api.items.setCompleted(listId, item.id, item.completed === 0),
    // Optimistic toggle so the checkbox feels instant.
    onMutate: async (item: Item) => {
      await qc.cancelQueries({ queryKey: ["items", listId] });
      const prev = qc.getQueryData<Item[]>(["items", listId]);
      qc.setQueryData<Item[]>(["items", listId], (old) =>
        (old ?? []).map((i) =>
          i.id === item.id ? { ...i, completed: i.completed === 0 ? 1 : 0 } : i,
        ),
      );
      return { prev };
    },
    onError: (_err, _item, ctx) => {
      if (ctx?.prev) qc.setQueryData(["items", listId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["items", listId] }),
  });
}

export function useDeleteItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.items.remove(listId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items", listId] }),
  });
}

export function useSchedules(listId: string | null) {
  return useQuery({
    queryKey: ["schedules", listId],
    queryFn: () => api.schedules.list(listId!),
    enabled: !!listId,
  });
}

export function useCreateSchedule(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      rrule: string;
      dtstart: string;
      timezone: string;
    }) => api.schedules.create(listId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", listId] }),
  });
}

export function useDeleteSchedule(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) =>
      api.schedules.remove(listId, scheduleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules", listId] }),
  });
}

export function useOccurrences(scheduleId: string) {
  return useQuery({
    queryKey: ["occurrences", scheduleId],
    queryFn: () => api.schedules.occurrences(scheduleId),
  });
}

// Fetch occurrences for many Schedules at once and report each Schedule's next
// relevant Occurrence (first un-skipped, else first). Used to merge recurring
// entries date-wise into the one list without each row self-fetching.
export function useScheduleNextOccurrences(scheduleIds: string[]) {
  const results = useQueries({
    queries: scheduleIds.map((id) => ({
      queryKey: ["occurrences", id],
      queryFn: () => api.schedules.occurrences(id),
    })),
  });

  const byScheduleId: Record<string, Occurrence | undefined> = {};
  scheduleIds.forEach((id, i) => {
    const rows = results[i]?.data ?? [];
    byScheduleId[id] = rows.find((o) => !o.skipped) ?? rows[0];
  });

  const isLoading = results.some((r) => r.isLoading);
  return { byScheduleId, isLoading };
}

export function useSetOccurrence(scheduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { occurrenceAt: string; state: OccurrenceState }) =>
      api.schedules.setOccurrence(scheduleId, args.occurrenceAt, args.state),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["occurrences", scheduleId] }),
  });
}

// --- Email Ingestion ------------------------------------------------------

// Suggested (pending) Items in a List, awaiting review (ADR-0005).
export function usePendingItems(listId: string | null) {
  return useQuery({
    queryKey: ["pending", listId],
    queryFn: () => api.ingestion.pending(listId!),
    enabled: !!listId,
  });
}

export function useConfirmPendingItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      itemId: string;
      edits?: { title?: string; due?: Due | null };
    }) => api.ingestion.confirm(listId, args.itemId, args.edits),
    onSuccess: () => {
      // The item leaves the review queue and joins the real list.
      qc.invalidateQueries({ queryKey: ["pending", listId] });
      qc.invalidateQueries({ queryKey: ["items", listId] });
    },
  });
}

export function useRejectPendingItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.ingestion.reject(listId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending", listId] }),
  });
}

// A List's inbound address (null until minted).
export function useInboxAddress(listId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["inboxAddress", listId],
    queryFn: () => api.ingestion.inboxAddress(listId!),
    enabled: !!listId && enabled,
  });
}

export function useGenerateInboxAddress(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ingestion.generateInboxAddress(listId),
    onSuccess: (data) =>
      qc.setQueryData<InboxAddress>(["inboxAddress", listId], data),
  });
}

// --- Reminders ------------------------------------------------------------

export function useItemReminders(listId: string, itemId: string) {
  return useQuery({
    queryKey: ["reminders", "item", itemId],
    queryFn: () => api.reminders.forItem(listId, itemId),
  });
}

export function useAddItemReminder(listId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offsetMinutes: number) =>
      api.reminders.addToItem(listId, itemId, offsetMinutes),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["reminders", "item", itemId] }),
  });
}

export function useScheduleReminders(listId: string, scheduleId: string) {
  return useQuery({
    queryKey: ["reminders", "schedule", scheduleId],
    queryFn: () => api.reminders.forSchedule(listId, scheduleId),
  });
}

export function useAddScheduleReminder(listId: string, scheduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offsetMinutes: number) =>
      api.reminders.addToSchedule(listId, scheduleId, offsetMinutes),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["reminders", "schedule", scheduleId] }),
  });
}

// Removing a Reminder needs to invalidate whichever anchor list it belonged to;
// the caller passes the anchor key so we can target the right query.
export function useRemoveReminder(
  anchor: { type: "item" | "schedule"; id: string },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reminderId: string) => api.reminders.remove(reminderId),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["reminders", anchor.type, anchor.id],
      }),
  });
}

export type { Item, List, Family, Reminder, InboxAddress };
