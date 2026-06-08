import { useState } from "react";
import type { Schedule } from "../api.ts";
import {
  useSchedules,
  useCreateSchedule,
  useDeleteSchedule,
} from "../hooks.ts";
import {
  WEEKDAYS,
  draftToRule,
  describeRule,
  type Frequency,
} from "../recurrence.ts";
import { ScheduleOccurrences } from "./ScheduleOccurrences.tsx";

export function SchedulesSection({ listId }: { listId: string }) {
  const schedules = useSchedules(listId);
  const createSchedule = useCreateSchedule(listId);
  const deleteSchedule = useDeleteSchedule(listId);
  const [adding, setAdding] = useState(false);

  const rows = schedules.data ?? [];

  return (
    <section className="schedules">
      <div className="schedules-head">
        <h3>Recurring</h3>
        <button className="btn small" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "+ Add recurring"}
        </button>
      </div>

      {adding && (
        <NewScheduleForm
          pending={createSchedule.isPending}
          onCreate={async (input) => {
            await createSchedule.mutateAsync(input);
            setAdding(false);
          }}
        />
      )}

      {rows.length === 0 ? (
        !adding && <p className="muted small">No recurring items.</p>
      ) : (
        <ul className="schedule-list">
          {rows.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onDelete={() => {
                if (confirm(`Delete recurring "${s.title}"?`))
                  deleteSchedule.mutate(s.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduleCard({
  schedule,
  onDelete,
}: {
  schedule: Schedule;
  onDelete: () => void;
}) {
  return (
    <li className="schedule-card">
      <div className="schedule-card-head">
        <div>
          <strong>{schedule.title}</strong>
          <div className="muted small">{describeRule(schedule.rrule)}</div>
        </div>
        <button className="icon-btn" title="Delete" onClick={onDelete}>
          ×
        </button>
      </div>
      <ScheduleOccurrences scheduleId={schedule.id} />
    </li>
  );
}

function NewScheduleForm({
  pending,
  onCreate,
}: {
  pending: boolean;
  onCreate: (input: {
    title: string;
    rrule: string;
    dtstart: string;
    timezone: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [weekdays, setWeekdays] = useState<string[]>(["TU"]);
  const [time, setTime] = useState("17:30");

  function toggleDay(code: string) {
    setWeekdays((cur) =>
      cur.includes(code) ? cur.filter((d) => d !== code) : [...cur, code],
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const { rrule, dtstart, timezone } = draftToRule({
      frequency,
      weekdays,
      time,
    });
    onCreate({ title: t, rrule, dtstart, timezone });
  }

  return (
    <form className="new-schedule" onSubmit={submit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Gymnastics"
        aria-label="Recurring item title"
        autoFocus
      />

      <div className="freq-row">
        <label>
          <input
            type="radio"
            name="freq"
            checked={frequency === "weekly"}
            onChange={() => setFrequency("weekly")}
          />
          Weekly
        </label>
        <label>
          <input
            type="radio"
            name="freq"
            checked={frequency === "daily"}
            onChange={() => setFrequency("daily")}
          />
          Daily
        </label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Time"
        />
      </div>

      {frequency === "weekly" && (
        <div className="weekday-row">
          {WEEKDAYS.map((w) => (
            <button
              type="button"
              key={w.code}
              className={
                weekdays.includes(w.code) ? "day-btn active" : "day-btn"
              }
              onClick={() => toggleDay(w.code)}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}

      <button className="btn btn-primary small" disabled={pending}>
        Create recurring
      </button>
    </form>
  );
}
