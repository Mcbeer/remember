# Pin test tooling: vitest-pool-workers 0.8.71 + vitest ~3.2

Tests run in the Workers runtime via `@cloudflare/vitest-pool-workers` against a
real Miniflare D1 (migrations applied with `readD1Migrations` / `applyD1Migrations`).

We pin `@cloudflare/vitest-pool-workers@0.8.71` and `vitest@~3.2`. Do **not**
upgrade to the npm `latest` tag: at time of writing `latest` is `0.16.13`, a beta
that removed the `./config` subpath export (`defineWorkersConfig`,
`readD1Migrations`), which `vitest.config.ts` depends on. The stable 0.8.x line
that ships `./config` requires vitest `2.0.x – 3.2.x`, hence vitest is held at 3.2
(not 4).

Revisit when the 0.16.x line stabilises and restores a documented config helper
for migrations; until then, a naive `npm update` to "latest" will break the test
setup with `Missing "./config" specifier`.
