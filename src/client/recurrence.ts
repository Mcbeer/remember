import { browserTimezone } from "./datetime.ts";

// Build the (rrule, dtstart, timezone) triple from simple UI presets. The
// backend stores the full iCalendar RRULE, so richer rules can be added later
// without schema change (ADR-0004).

export type Frequency = "daily" | "weekly";

// iCalendar weekday codes, Monday-first to match the UI.
export const WEEKDAYS = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
] as const;

export type ScheduleDraft = {
  frequency: Frequency;
  weekdays: string[]; // for weekly; iCal codes
  time: string; // "HH:MM" local wall-clock
};

// Compose the RRULE string + a UTC dtstart anchored at the next matching local
// time, plus the browser timezone.
export function draftToRule(draft: ScheduleDraft): {
  rrule: string;
  dtstart: string;
  timezone: string;
} {
  const [h, m] = draft.time.split(":").map(Number);

  // Anchor dtstart today at the chosen local time (rule generation handles the
  // recurrence from there; the exact anchor day only matters as a starting point).
  const anchor = new Date();
  anchor.setHours(h ?? 0, m ?? 0, 0, 0);

  let rrule: string;
  if (draft.frequency === "daily") {
    rrule = "FREQ=DAILY";
  } else {
    const days = draft.weekdays.length ? draft.weekdays.join(",") : "MO";
    rrule = `FREQ=WEEKLY;BYDAY=${days}`;
  }

  return {
    rrule,
    dtstart: anchor.toISOString(),
    timezone: browserTimezone(),
  };
}

// Human summary of a stored RRULE for display.
export function describeRule(rrule: string): string {
  if (rrule.startsWith("FREQ=DAILY")) return "Every day";
  if (rrule.startsWith("FREQ=WEEKLY")) {
    const m = rrule.match(/BYDAY=([A-Z,]+)/);
    if (m) {
      const labels = m[1]
        .split(",")
        .map((c) => WEEKDAYS.find((w) => w.code === c)?.label ?? c);
      return `Weekly: ${labels.join(", ")}`;
    }
    return "Weekly";
  }
  return rrule;
}
