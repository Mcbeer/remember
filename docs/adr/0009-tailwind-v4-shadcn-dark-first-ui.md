# UI built on Tailwind v4 + selective shadcn, dark-first

The hand-rolled `src/client/styles.css` (bespoke `.btn`/`.sidebar`/`.item`
classes, one accent blue, no breakpoints) is replaced with **Tailwind CSS v4**
(via `@tailwindcss/vite`, CSS-first config — no `tailwind.config.js`/PostCSS)
and **shadcn** components added **selectively** (only what we use: Button,
Input, Checkbox, Dialog, Sheet, etc.), copied into the repo rather than pulled
as a runtime framework. We accept the Radix/`clsx`/`tailwind-merge` dependency
weight because the app ships as an installable PWA — the bundle is cached after
first load, so it's a one-time cost — and because rolling our own accessible
Dialog/Sheet (the mobile drawer the redesign needs) is exactly the bug-prone
work shadcn removes.

**Dark-first**: the dark palette lives unconditionally in `:root` (the inverse
of shadcn's scaffold, which puts light in `:root` and dark in `.dark`). There is
no theme toggle and `prefers-color-scheme` is **ignored** — every user gets dark
for now. A light theme is deferred and becomes purely additive (a `.light` block
+ wiring system preference/toggle) later.

The migration is **big-bang**: all 8 client components (Login, Home, Sidebar,
FamilySection, ItemsPanel, SchedulesSection, ScheduleOccurrences, Join) are
converted in one pass and `styles.css` is deleted. This is a redesign, not a
refactor — the old visual language is discarded wholesale, so there is nothing
to preserve incrementally and we avoid a period where two styling systems clash.

## Considered Options

- **Tailwind-only (no shadcn)** — leanest, but we'd hand-roll accessible
  Dialog/Sheet/focus-trap behaviour, the riskiest part of the mobile work.
- **Tailwind v3 (JS config + PostCSS)** — more documented, but fights the
  current shadcn CLI and our Vite 8 / React 19 / TS 6 stack; v4 composes as a
  sibling Vite plugin to `@cloudflare/vite-plugin`.
- **Dark-ready tokens, light default** — shadcn's normal path; rejected because
  the product wants dark as the actual default, not a later opt-in.
- **Incremental migration** — lower per-step risk, but maintains two styling
  systems and offers nothing to preserve in a full redesign.

## Consequences

- Tailwind v4 assumes a modern browser baseline (cascade layers, `@property`,
  `color-mix()`). Fine for a modern-mobile PWA; would bite on old Android
  WebViews.
- Backlog item 6 in `PROGRESS.md` is now decided, not open.
