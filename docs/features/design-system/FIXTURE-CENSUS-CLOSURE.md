# Fixture census closure

## Finding

`scripts/fixture-census.ts` reported `?source=fixture` as a fixture URL without checking whether a route still accepted `source`. The maintained route modules use `demo` seeds where they have seeds. `useRoute` reads `demo` from the current URL and selects `manifest.seeds[demo]`. A truthful live URL does not count as fixture coverage.

## Canonical review URLs

| Class | Routes |
| --- | --- |
| Demo fixture | `/chat?demo=diagram`, `/families?demo=plan`, `/family?demo=plan`, `/instances?demo=refresh`, `/settings?demo=save`, `/takeoffs?demo=sync` |
| Inherent static | `/`, `/doc-lab`, `/grilles` |
| Non-fixture live route | `/data-tables`, `/ops`, `/parameter-links`, `/runs`, `/schedule-grid` |
| Prototype | `/family-editor-proto`, `/family-review-proto`, `/lab`, `/param-tables` |

The test imports `CHAT_SEEDS`, `familiesManifest.seeds`, `familyManifest().seeds`, `INSTANCES_SEEDS`, `SETTINGS_SEEDS`, and `takeoffSeeds`. Every canonical `demo` name exists in the corresponding production seed object. The census reports `missingReviewUrls` separately from `nonFixtureLiveRoutes`; `missingCanonicalFixtures` counts both groups. It rejects every canonical URL carrying `source`.

`missingReviewUrls` is empty. `nonFixtureLiveRoutes` contains five routes, so `missingCanonicalFixtures` is 5. `/data-tables`, `/ops`, `/parameter-links`, and `/schedule-grid` require runtime review. `/parameter-links` explicitly has no seed and treats `demo` as inert. `/runs` is also non-fixture: `liveRunsSource` calls `fetchRunIndex` and artifact loaders, and `runs/world.ts` fetches from `/api/runs-data`.

`/lab` is an explicit prototype because `routes/lab.tsx` mounts `SyntheticRunner` over `syntheticOps`; `docs/features/ops/LEDGER.md` records that it is parked outside `/ops`. It is not an inherent-static route.

## Evidence

- `vp check scripts/fixture-census.ts scripts/fixture-census.test.ts`: pass.
- `vp test scripts/fixture-census.test.ts`: 1 file, 3 tests pass.
- `vp run fixture-census`: 14 maintained routes, 0 `missingReviewUrls`, 5 non-fixture live routes, and 5 missing canonical fixtures; 4 explicit prototypes, 5 design-system specimens, and 4 API routes.

## Scope

`src/families/matrix.tsx` now links its original review fixture to `/families?demo=plan`, which exists in `familiesManifest.seeds`. The retired `fixture=native` destination has no seed equivalent, so the link was removed instead of being redirected to a different review state. The production-source link census finds no remaining emitted `source=fixture` URL.
