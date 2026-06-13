import { useMemo, useRef, useState } from "react";
import { Pencil, X, Repeat, SkipForward, CalendarPlus } from "lucide-react";
import type { Item, Schedule, Occurrence } from "../api.ts";
import {
  useItems,
  useCreateItem,
  useToggleItem,
  useEditItem,
  useDeleteItem,
  useSchedules,
  useCreateSchedule,
  useDeleteSchedule,
  useScheduleNextOccurrences,
  useSetOccurrence,
} from "../hooks.ts";
import {
  localInputToDue,
  formatDue,
  isOverdue,
  dueToLocalInput,
} from "../datetime.ts";
import {
  WEEKDAYS,
  draftToRule,
  describeRule,
  type Frequency,
} from "../recurrence.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/lib/utils.ts";
import { ItemReminders, ScheduleReminders } from "./Reminders.tsx";

export function ItemsPanel({
  listId,
  listName,
}: {
  listId: string;
  listName: string;
}) {
  const items = useItems(listId);
  const schedules = useSchedules(listId);
  const toggleItem = useToggleItem(listId);
  const deleteItem = useDeleteItem(listId);

  const itemRows = items.data ?? [];
  const scheduleRows = schedules.data ?? [];

  // Fetch each Schedule's next Occurrence so recurring entries can interleave
  // with Items by date.
  const scheduleIds = useMemo(() => scheduleRows.map((s) => s.id), [scheduleRows]);
  const { byScheduleId, isLoading: occLoading } =
    useScheduleNextOccurrences(scheduleIds);

  const loading = items.isLoading || schedules.isLoading || occLoading;
  const empty = itemRows.length === 0 && scheduleRows.length === 0;

  // One date-sorted list of Items and recurring entries. The sort key is the
  // due/occurrence instant; anything without one (undated Item, Schedule whose
  // next Occurrence hasn't resolved) sinks to the bottom, ties broken by title.
  type Entry =
    | { kind: "item"; sortKey: number; item: Item }
    | { kind: "schedule"; sortKey: number; schedule: Schedule; next?: Occurrence };

  const entries = useMemo<Entry[]>(() => {
    const FAR = Number.POSITIVE_INFINITY;
    const out: Entry[] = [
      ...itemRows.map(
        (item): Entry => ({
          kind: "item",
          sortKey: item.dueAt ? new Date(item.dueAt).getTime() : FAR,
          item,
        }),
      ),
      ...scheduleRows.map((schedule): Entry => {
        const next = byScheduleId[schedule.id];
        return {
          kind: "schedule",
          sortKey: next ? new Date(next.occurrenceAt).getTime() : FAR,
          schedule,
          next,
        };
      }),
    ];
    out.sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      const at = a.kind === "item" ? a.item.title : a.schedule.title;
      const bt = b.kind === "item" ? b.item.title : b.schedule.title;
      return at.localeCompare(bt);
    });
    return out;
  }, [itemRows, scheduleRows, byScheduleId]);

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">{listName}</h2>

      <AddEntryForm listId={listId} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : empty ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((e) =>
            e.kind === "item" ? (
              <ItemRow
                key={`i:${e.item.id}`}
                listId={listId}
                item={e.item}
                onToggle={() => toggleItem.mutate(e.item)}
                onDelete={() => deleteItem.mutate(e.item.id)}
              />
            ) : (
              <ScheduleRow
                key={`s:${e.schedule.id}`}
                listId={listId}
                schedule={e.schedule}
                next={e.next}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

// A calendar-icon button that opens the browser's native datetime picker
// (no manual typing). The actual <input type="datetime-local"> is kept in the
// DOM but visually collapsed; we call showPicker() on it from the button. When
// a value is set the icon turns into the formatted date with a clear (×).
function DatePickerButton({
  value,
  onChange,
  label = "Set due date",
}: {
  value: string; // datetime-local string ("" = none)
  onChange: (value: string) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = ref.current;
    if (!el) return;
    // showPicker is the supported way to open the native picker on click.
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // some browsers throw if not user-activated; fall through to focus
      }
    }
    el.focus();
  }

  return (
    <div className="relative inline-flex items-center">
      {value ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1.5 text-sm">
          <button
            type="button"
            className="cursor-pointer"
            onClick={openPicker}
            title="Change due date"
          >
            {formatDue(localInputToDue(value)?.at ?? value)}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onChange("")}
            title="Clear due date"
            aria-label="Clear due date"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={openPicker}
          title={label}
          aria-label={label}
        >
          <CalendarPlus />
        </Button>
      )}
      {/* Visually collapsed but present so showPicker() has a target. */}
      <input
        ref={ref}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        tabIndex={-1}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
      />
    </div>
  );
}

// Single add form for both a one-off Item and a recurring Schedule. Ticking
// "repeats" reveals the recurrence controls and routes the create through the
// Schedule API instead of the Item API — the two stay distinct in the model
// (an Item is completable; a Schedule generates Occurrences) but share one
// entry UI.
function AddEntryForm({ listId }: { listId: string }) {
  const createItem = useCreateItem(listId);
  const createSchedule = useCreateSchedule(listId);

  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [repeats, setRepeats] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [weekdays, setWeekdays] = useState<string[]>(["TU"]);
  const [time, setTime] = useState("17:30");

  const pending = createItem.isPending || createSchedule.isPending;

  function toggleDay(code: string) {
    setWeekdays((cur) =>
      cur.includes(code) ? cur.filter((d) => d !== code) : [...cur, code],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    if (repeats) {
      const { rrule, dtstart, timezone } = draftToRule({
        frequency,
        weekdays,
        time,
      });
      await createSchedule.mutateAsync({ title: trimmed, rrule, dtstart, timezone });
      setRepeats(false);
    } else {
      await createItem.mutateAsync({
        title: trimmed,
        due: localInputToDue(due) ?? undefined,
      });
    }
    setTitle("");
    setDue("");
  }

  return (
    <form className="mb-6 flex flex-col gap-3" onSubmit={submit}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={repeats ? "Add a recurring item…" : "Add an item…"}
          aria-label="New entry title"
          className="sm:flex-1"
        />
        <div className="flex gap-2">
          {!repeats && <DatePickerButton value={due} onChange={setDue} />}
          <Button type="submit" disabled={pending}>
            Add
          </Button>
        </div>
      </div>

      <Label className="flex w-fit items-center gap-2 font-normal text-muted-foreground">
        <Checkbox
          checked={repeats}
          onCheckedChange={(v) => setRepeats(v === true)}
          aria-label="Repeats"
        />
        <Repeat className="size-3.5" />
        Repeats
      </Label>

      {repeats && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5">
          <div className="flex flex-wrap items-center gap-4">
            <Label className="flex items-center gap-2 font-normal">
              <input
                type="radio"
                name="freq"
                className="accent-primary"
                checked={frequency === "weekly"}
                onChange={() => setFrequency("weekly")}
              />
              Weekly
            </Label>
            <Label className="flex items-center gap-2 font-normal">
              <input
                type="radio"
                name="freq"
                className="accent-primary"
                checked={frequency === "daily"}
                onChange={() => setFrequency("daily")}
              />
              Daily
            </Label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Time"
              className="h-9 w-auto"
            />
          </div>

          {frequency === "weekly" && (
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => (
                <button
                  type="button"
                  key={w.code}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    weekdays.includes(w.code)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input hover:bg-accent",
                  )}
                  onClick={() => toggleDay(w.code)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </form>
  );
}

// A recurring entry in the list: shows only its NEXT Occurrence. Ticking
// completes that one Occurrence (it rolls to the next); the recurrence itself
// is removed via the delete action. A single Occurrence can also be edited
// one-off — retitled or rescheduled — without touching the rule (ADR-0004).
function ScheduleRow({
  listId,
  schedule,
  next,
}: {
  listId: string;
  schedule: Schedule;
  next?: Occurrence;
}) {
  const setOcc = useSetOccurrence(schedule.id);
  const deleteSchedule = useDeleteSchedule(listId);
  const [editing, setEditing] = useState(false);

  // The instant this Occurrence actually lands on (override wins); its
  // identity for addressing is always the canonical rule instant.
  const effectiveAt = next ? (next.overrideAt ?? next.occurrenceAt) : null;
  const moved = !!next?.overrideAt;

  if (editing && next) {
    return (
      <OccurrenceEditRow
        schedule={schedule}
        next={next}
        pending={setOcc.isPending}
        onCancel={() => setEditing(false)}
        onSave={async ({ overrideTitle, overrideAt }) => {
          await setOcc.mutateAsync({
            occurrenceAt: next.occurrenceAt,
            state: { overrideTitle, overrideAt },
          });
          setEditing(false);
        }}
      />
    );
  }

  return (
    <li className="group flex items-center gap-3 border-b border-border py-3">
      <Checkbox
        checked={next?.completed ?? false}
        disabled={!next || next.skipped}
        aria-label="Complete this occurrence"
        onCheckedChange={() =>
          next &&
          setOcc.mutate({
            occurrenceAt: next.occurrenceAt,
            state: { completed: !next.completed },
          })
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "flex items-center gap-1.5 truncate",
            next?.completed && "text-muted-foreground line-through",
          )}
        >
          <Repeat className="size-3.5 shrink-0 text-muted-foreground" />
          {next?.title ?? schedule.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {effectiveAt ? (
            <>
              {formatDue(effectiveAt)}
              {moved && (
                <span className="ml-1.5 italic">(moved this time)</span>
              )}
            </>
          ) : (
            describeRule(schedule.rrule)
          )}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <ScheduleReminders
          listId={listId}
          scheduleId={schedule.id}
          title={schedule.title}
        />
        {next && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Edit this occurrence"
              aria-label="Edit this occurrence"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Skip this occurrence"
              aria-label="Skip this occurrence"
              onClick={() =>
                setOcc.mutate({
                  occurrenceAt: next.occurrenceAt,
                  state: { skipped: !next.skipped },
                })
              }
            >
              <SkipForward className="size-4" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete recurring"
          aria-label="Delete recurring"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => {
            if (confirm(`Delete recurring "${schedule.title}"?`))
              deleteSchedule.mutate(schedule.id);
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    </li>
  );
}

// Inline editor for a one-off Occurrence edit. Title defaults to the effective
// title; the date picker defaults to the effective instant. Saving sends the
// override values (empty title clears back to the Schedule's title; clearing
// the date clears the reschedule, returning to the rule's instant).
function OccurrenceEditRow({
  schedule,
  next,
  pending,
  onSave,
  onCancel,
}: {
  schedule: Schedule;
  next: Occurrence;
  pending: boolean;
  onSave: (patch: {
    overrideTitle: string | null;
    overrideAt: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const effectiveAt = next.overrideAt ?? next.occurrenceAt;
  const [title, setTitle] = useState(next.title);
  const [due, setDue] = useState(dueToLocalInput(effectiveAt));

  function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    // A title equal to the Schedule's default clears the override.
    const overrideTitle =
      !trimmed || trimmed === schedule.title ? null : trimmed;
    // A date equal to the rule's instant clears the reschedule.
    const at = due ? (localInputToDue(due)?.at ?? null) : null;
    const overrideAt = at === next.occurrenceAt ? null : at;
    onSave({ overrideTitle, overrideAt });
  }

  return (
    <li className="border-b border-border py-3">
      <form className="flex flex-col gap-2" onSubmit={save}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Occurrence title"
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-2">
          <DatePickerButton
            value={due}
            onChange={setDue}
            label="Reschedule this occurrence"
          />
          <div className="ml-auto flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </li>
  );
}

function ItemRow({
  listId,
  item,
  onToggle,
  onDelete,
}: {
  listId: string;
  item: Item;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const editItem = useEditItem(listId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [due, setDue] = useState(item.dueAt ? dueToLocalInput(item.dueAt) : "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await editItem.mutateAsync({
      itemId: item.id,
      patch: {
        title: trimmed,
        due: due ? localInputToDue(due) : null,
      },
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="border-b border-border py-3">
        <form className="flex flex-col gap-2" onSubmit={save}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Item title"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <DatePickerButton value={due} onChange={setDue} />
            <div className="ml-auto flex gap-2">
              <Button type="submit" size="sm" disabled={editItem.isPending}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </li>
    );
  }

  const done = item.completed === 1;

  return (
    <li className="group flex items-center gap-3 border-b border-border py-3">
      <Checkbox
        checked={done}
        onCheckedChange={onToggle}
        aria-label={done ? "Mark incomplete" : "Mark complete"}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate", done && "text-muted-foreground line-through")}>
          {item.title}
        </span>
        {item.dueAt && (
          <span
            className={cn(
              "text-xs",
              isOverdue(item.dueAt) && !done
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {formatDue(item.dueAt)}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <ItemReminders listId={listId} itemId={item.id} title={item.title} />
        <Button
          variant="ghost"
          size="icon-sm"
          title="Edit item"
          aria-label="Edit item"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Delete item"
          aria-label="Delete item"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <X className="size-4" />
        </Button>
      </div>
    </li>
  );
}
