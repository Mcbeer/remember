import { RRule, rrulestr } from "rrule";

// Expand a Schedule's recurrence rule into occurrence instants within a window
// (ADR-0004: Occurrences are computed, not stored, unless they carry state).
//
// We work entirely in UTC instants. dtstart is the UTC anchor; the stored RRULE
// string carries the recurrence. rrule's `between` enumerates matching instants.
// The `timezone` on the Schedule is informational for display/reminders — the
// stored dtstart already encodes the correct absolute instant.

export function expandOccurrences(
  rruleString: string,
  dtstart: string,
  fromIso: string,
  toIso: string,
): string[] {
  // Build an RRule anchored at dtstart. rrule treats Date objects as UTC wall
  // clock when constructed from an ISO instant, so we keep everything in UTC.
  const options = RRule.parseString(rruleString);
  options.dtstart = new Date(dtstart);
  const rule = new RRule(options);

  const from = new Date(fromIso);
  const to = new Date(toIso);

  // `between` is inclusive of both bounds.
  return rule.between(from, to, true).map((d) => d.toISOString());
}

// Validate that a string is a parseable RRULE (used on Schedule creation).
export function isValidRRule(rruleString: string, dtstart: string): boolean {
  try {
    const options = RRule.parseString(rruleString);
    options.dtstart = new Date(dtstart);
    // Constructing the rule throws on malformed options.
    rrulestr(new RRule(options).toString());
    return true;
  } catch {
    return false;
  }
}
