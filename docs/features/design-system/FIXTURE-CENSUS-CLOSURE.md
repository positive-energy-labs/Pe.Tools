# Fixture census closure

## Finding

`scripts/fixture-census.ts` reported `?source=fixture` as a fixture URL without checking whether a route still accepted `source`. The maintained route modules now use `demo` seeds where they have seeds. `useRoute` reads `demo` from the current URL and selects `manifest.seeds[demo]`.

## Canonical review URLs

| Class | Routes |
| --- | --- |
| Demo fixture | `/chat?demo=diagram`, `/families?demo=plan`, `/family?demo=plan`, `/instances?demo=refresh`, `/settings?demo=save`, `/takeoffs?demo=sync` |
| Inherent static | `/`, `/doc-lab`, `/grilles`, `/runs` |
| Live route | `/data-tables`, `/ops`, `/parameter-links`, `/schedule-grid` |
| Prototype | `/family-editor-proto`, `/family-review-proto`, `/lab`, `/param-tables` |

The test imports `CHAT_SEEDS`, `familiesManifest.seeds`, `familyManifest().seeds`, `INSTANCES_SEEDS`, `SETTINGS_SEEDS`, and `takeoffSeeds`. Every canonical `demo` name exists in the corresponding production seed object. The census rejects an unclassified maintained route and rejects every canonical URL carrying `source`.

`/lab` is an explicit prototype because `routes/lab.tsx` mounts `SyntheticRunner` over `syntheticOps`; `docs/features/ops/LEDGER.md` records that it is parked outside `/ops`. It is not an inherent-static route.

## Evidence

- `vp check scripts/fixture-census.ts scripts/fixture-census.test.ts`: pass.
- `vp test scripts/fixture-census.test.ts`: 1 file, 3 tests pass.
- `vp run fixture-census`: 14 maintained routes, 0 missing classifications; 4 explicit prototypes, 5 design-system specimens, and 4 API routes.

## Scope

No production route changed. `src/families/matrix.tsx` still contains two old `source=fixture` links, outside this census-only scope; they are not used as canonical review URLs.
