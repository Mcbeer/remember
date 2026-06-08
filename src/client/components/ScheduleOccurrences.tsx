import { useOccurrences, useSetOccurrence } from "../hooks.ts";
import { formatDue } from "../datetime.ts";

// Upcoming Occurrences of a Schedule, each tickable/skippable independently.
export function ScheduleOccurrences({ scheduleId }: { scheduleId: string }) {
  const occ = useOccurrences(scheduleId);
  const setOcc = useSetOccurrence(scheduleId);

  if (occ.isLoading) return <p className="muted small">Loading…</p>;
  const rows = occ.data ?? [];
  if (rows.length === 0)
    return <p className="muted small">No upcoming occurrences.</p>;

  // Show the next handful so the card stays compact.
  const upcoming = rows.slice(0, 5);

  return (
    <ul className="occurrences">
      {upcoming.map((o) => (
        <li
          key={o.occurrenceAt}
          className={o.skipped ? "occurrence skipped" : "occurrence"}
        >
          <label className="occurrence-main">
            <input
              type="checkbox"
              checked={o.completed}
              disabled={o.skipped}
              onChange={() =>
                setOcc.mutate({
                  occurrenceAt: o.occurrenceAt,
                  state: { completed: !o.completed },
                })
              }
            />
            <span className={o.completed ? "done" : ""}>
              {formatDue(o.occurrenceAt)}
            </span>
          </label>
          <button
            className="link-btn small"
            onClick={() =>
              setOcc.mutate({
                occurrenceAt: o.occurrenceAt,
                state: { skipped: !o.skipped },
              })
            }
          >
            {o.skipped ? "Unskip" : "Skip"}
          </button>
        </li>
      ))}
    </ul>
  );
}
