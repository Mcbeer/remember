import { Bell, BellRing, X } from "lucide-react";
import type { Reminder } from "../api.ts";
import {
  useItemReminders,
  useAddItemReminder,
  useScheduleReminders,
  useAddScheduleReminder,
  useRemoveReminder,
} from "../hooks.ts";
import { pushSupported } from "../push.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";

// Preset offsets (minutes before the due moment) offered when adding a Reminder.
const PRESETS: { label: string; minutes: number }[] = [
  { label: "At time", minutes: 0 },
  { label: "10 min", minutes: 10 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 60 * 24 },
];

export function formatOffset(minutes: number): string {
  if (minutes === 0) return "At time";
  if (minutes % (60 * 24) === 0) {
    const d = minutes / (60 * 24);
    return `${d} day${d > 1 ? "s" : ""} before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h > 1 ? "s" : ""} before`;
  }
  return `${minutes} min before`;
}

// The bell button + dialog body shared by Items and Schedules. The data hooks
// differ per anchor, so the caller passes the loaded reminders, an add fn, and a
// remove fn; this component renders the common UI.
function RemindersDialog({
  title,
  reminders,
  pending,
  onAdd,
  onRemove,
}: {
  title: string;
  reminders: Reminder[];
  pending: boolean;
  onAdd: (minutes: number) => void;
  onRemove: (reminderId: string) => void;
}) {
  const hasAny = reminders.length > 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title={hasAny ? "Reminders set" : "Add a reminder"}
          aria-label={hasAny ? "Reminders set" : "Add a reminder"}
          className={cn(hasAny && "text-primary")}
        >
          {hasAny ? <BellRing className="size-4" /> : <Bell className="size-4" />}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reminders</DialogTitle>
          <DialogDescription>
            Web Push before “{title}” is due. Shared with everyone on the list.
          </DialogDescription>
        </DialogHeader>

        {hasAny && (
          <ul className="flex flex-col gap-1">
            {reminders
              .slice()
              .sort((a, b) => a.offsetMinutes - b.offsetMinutes)
              .map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span>{formatOffset(r.offsetMinutes)}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(r.id)}
                    aria-label="Remove reminder"
                    title="Remove reminder"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Add a reminder
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.filter(
              (p) => !reminders.some((r) => r.offsetMinutes === p.minutes),
            ).map((p) => (
              <Button
                key={p.minutes}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => onAdd(p.minutes)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {!pushSupported() && (
          <p className="text-xs text-muted-foreground">
            This device can’t receive Web Push. Reminders you add still fire on
            other devices where notifications are enabled.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ItemReminders({
  listId,
  itemId,
  title,
}: {
  listId: string;
  itemId: string;
  title: string;
}) {
  const reminders = useItemReminders(listId, itemId);
  const add = useAddItemReminder(listId, itemId);
  const remove = useRemoveReminder({ type: "item", id: itemId });

  return (
    <RemindersDialog
      title={title}
      reminders={reminders.data ?? []}
      pending={add.isPending || remove.isPending}
      onAdd={(m) => add.mutate(m)}
      onRemove={(id) => remove.mutate(id)}
    />
  );
}

export function ScheduleReminders({
  listId,
  scheduleId,
  title,
}: {
  listId: string;
  scheduleId: string;
  title: string;
}) {
  const reminders = useScheduleReminders(listId, scheduleId);
  const add = useAddScheduleReminder(listId, scheduleId);
  const remove = useRemoveReminder({ type: "schedule", id: scheduleId });

  return (
    <RemindersDialog
      title={title}
      reminders={reminders.data ?? []}
      pending={add.isPending || remove.isPending}
      onAdd={(m) => add.mutate(m)}
      onRemove={(id) => remove.mutate(id)}
    />
  );
}
