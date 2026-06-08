import {
  useQuery,
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

export function useSetOccurrence(scheduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      occurrenceAt: string;
      state: { completed?: boolean; skipped?: boolean };
    }) => api.schedules.setOccurrence(scheduleId, args.occurrenceAt, args.state),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["occurrences", scheduleId] }),
  });
}

export type { Item, List, Family };
