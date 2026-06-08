# Recurrence via Schedules generating computed Occurrences

Recurring things ("Gymnastics @17:30 every Tuesday") are modelled as a
**Schedule** — a recurrence rule (RRULE-style) belonging to a List — separate
from Item. An Item stays a single completable thing; a Schedule is never
"completed", it generates **Occurrences**.

Occurrences are **computed on demand** from the Schedule's rule for the visible
window. A row is persisted only when an Occurrence carries its own state:
completed, skipped, or a one-off edit (an exception). This keeps storage compact,
makes "cancel just next week" a single exception row, and lets the future
Reminder scheduler enumerate upcoming Occurrences from rules.

Rejected: a recurrence flag on Item (makes "completed" ambiguous, loses
per-occurrence history, messy for shared completion) and fully materialising
Occurrence rows ahead of time (unbounded growth, constant regeneration, rule
edits rewrite future rows).

A Schedule belongs to a List, inheriting the same personal/Family ownership and
sharing rules as Items. Reminders attach to either an Item (its due time) or a
Schedule (per Occurrence).
