import type { Due } from "./api.ts";

// The browser's IANA timezone, captured when a due time is set so reminders and
// display stay correct across DST (matches the schema's UTC-instant + tz pair).
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// <input type="datetime-local"> gives a local wall-clock string like
// "2026-06-09T17:30". Interpret it in the browser's zone -> a UTC instant.
export function localInputToDue(value: string): Due | null {
  if (!value) return null;
  const ms = new Date(value).getTime(); // parsed as local time
  if (Number.isNaN(ms)) return null;
  return { at: new Date(ms).toISOString(), timezone: browserTimezone() };
}

// UTC instant -> the value a datetime-local input expects (local wall clock,
// no timezone, minute precision).
export function dueToLocalInput(at: string): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Friendly display of a due instant in the user's locale/zone.
export function formatDue(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Is this instant in the past (overdue)?
export function isOverdue(at: string): boolean {
  return new Date(at).getTime() < Date.now();
}
