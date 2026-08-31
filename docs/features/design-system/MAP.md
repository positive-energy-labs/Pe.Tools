# Reference parity frontier

## Settled

- Recipient and instrument tree: `866760fa980da9897fc5a01c4dbb3e41d7524d41` on `goal/style-wave0`.
- Donor and projection tree: `8d0fc53b544f9e2fd324aaef53a66937be01df93` on `goal/style-donor`.
- Merge base: `f929149c498ac9525e9e616df65e601c9cb39eab`.
- The canonical census contains 14 maintained routes. It excludes API, prototype, and design-system specimen routes.
- Donor authority is highest for `/takeoffs`; high for `/family` and `/chat`; secondary for `/families` and `/settings`; and POC for every other route.
- `SYSTEM` means the fixture needs a shared product or state boundary. `ROUTE` means the fixture fits behind a route-local source seam. `REJECT` means the projection would import design-review presentation or replace main-native composition.
- All 17 campaign commits fail `git apply --check` against the donor. Added fixture data can still be reused, but route and composition hunks require a main-native rewrite.

## Frontier

- [ ] / — `/`; already equivalent; inherent static fixture; evidence `src/routes/index.tsx`; authority POC; verdict ROUTE.
- [ ] /chat — `/chat?source=fixture`; needs a small main-native injection seam; evidence `3f1195d`, `src/workbench/fixture.tsx`; authority high; verdict SYSTEM.
- [ ] /data-tables — `/data-tables?source=fixture`; needs a small main-native injection seam; evidence `9e40450`, `src/routes/data-tables.tsx`; authority POC; verdict ROUTE.
- [ ] /doc-lab — `/doc-lab?source=fixture`; portable directly; evidence `3c81b24`, `src/grounded-doc/engine.ts`; authority POC; verdict ROUTE.
- [ ] /families — `/families?source=fixture`; needs a small main-native injection seam; evidence `7ef549f` and `b941ffa`, `src/families/fixture.ts`; authority secondary; verdict SYSTEM.
- [ ] /family — `/family?source=fixture`; needs a small main-native injection seam; evidence `dda7bc5`, `src/family/fixture.ts`; authority high; verdict SYSTEM.
- [ ] /grilles — `/grilles`; already equivalent; inherent static fixture; evidence `src/routes/grilles.tsx`; authority POC; verdict ROUTE.
- [ ] /instances — `/instances?source=fixture`; blocked by product and state divergence; evidence `ee22e32`, missing donor `src/instances/workspace.tsx`; authority POC; verdict REJECT.
- [ ] /ops — `/ops?source=fixture`; blocked by product and state divergence; evidence `7ad5473`, missing donor `src/ops/route-workspace.tsx`; authority POC; verdict REJECT.
- [ ] /parameter-links — `/parameter-links?source=fixture`; blocked by product and state divergence; evidence `df252fe`, missing donor `src/parameter-links/profile-editor/view.tsx`; authority POC; verdict REJECT.
- [ ] /runs — `/runs?source=fixture`; blocked by product and state divergence; evidence `61e73f8`, missing donor split `src/runs/browser/model.ts`; authority POC; verdict REJECT.
- [ ] /schedule-grid — `/schedule-grid?source=fixture`; blocked by product and state divergence; evidence `edb991f`, missing donor `src/schedule-grid/route.tsx`; authority POC; verdict REJECT.
- [ ] /settings — `/settings?source=fixture`; needs a small main-native injection seam; evidence `5d5e4a4`, `src/settings/fixture.ts`; authority secondary; verdict SYSTEM.
- [ ] /takeoffs — `/takeoffs?source=fixture`; already equivalent; explicit project-a fixture host and source seam; evidence `src/routes/takeoffs.tsx`, `src/takeoff/proto/fixture-world.ts`; authority highest; verdict ROUTE.

## Campaign trace and ownership

| Route or concern | Fixture data and composition commits | Exact owned paths | Predicted donor conflict |
| --- | --- | --- | --- |
| census | `3709db7`, `82fa113`, `4794400`, `866760f` | `apps/web/package.json`; `apps/web/scripts/fixture-census.ts`; `apps/web/scripts/fixture-census.test.ts` | Donor has no census scripts and its package script block differs. |
| shared root | `ca5ecd1` | `src/routes/__root.tsx`; `src/host/live.test.tsx` | Root composition and Host test imports differ. Project the route-local source seam first. |
| `/doc-lab` | `3c81b24` | `src/routes/doc-lab.tsx`; `src/grounded-doc/engine.ts`; `src/grounded-doc/engine.test.tsx` | Same native engine exists, but normalized route text changed. Manual three-file projection is bounded. |
| `/settings` | `5d5e4a4` | `src/routes/settings.tsx`; `src/settings/fixture.ts`; `src/routes/-settings.test.tsx` | Route imports and workspace composition changed after the merge base. |
| `/family` | `dda7bc5` | `src/routes/family.tsx`; `src/family/fixture.ts`; `src/family/workspace.tsx`; `src/routes/-family.test.tsx` | Workspace was split and rewritten; fixture store types target the new state contract. |
| `/data-tables` | `9e40450` | `src/routes/data-tables.tsx`; `src/routes/-data-tables.test.tsx` | One large route changed presentation and state together; extract only its source branch. |
| `/families` | `7ef549f`, `b941ffa` | `src/routes/families.tsx`; `src/families/fixture.ts`; `src/families/head.tsx`; `src/families/workspace.tsx`; `src/families/store.test.ts`; `src/routes/-families.test.tsx` | Matrix composition and header contracts differ; enriched data depends on the recipient matrix. |
| `/instances` | `ee22e32` | `src/routes/instances.tsx`; `src/instances/fixture.tsx`; `src/instances/workspace.tsx`; `src/routes/-instances.test.tsx` | Donor has no workspace file and retains the monolithic route. |
| `/ops` | `7ad5473` | `src/routes/ops.tsx`; `src/ops/fixture.ts`; `src/ops/fixture.test.tsx`; `src/ops/store.ts`; `src/ops/route-workspace.tsx` | Donor has no route-workspace composition and its store contract predates the seam. |
| `/parameter-links` | `df252fe` | `src/routes/parameter-links.tsx`; `src/parameter-links/fixture.ts`; `src/parameter-links/profile-editor/definition-card.tsx`; `src/parameter-links/profile-editor/view.tsx`; `src/routes/-parameter-links.test.tsx` | Donor retains monolithic profile editor files. |
| `/schedule-grid` | `edb991f` | `src/routes/schedule-grid.tsx`; `src/schedule-grid/fixture.tsx`; `src/schedule-grid/route.tsx`; `src/schedule-grid/workspace.tsx`; `src/routes/-schedule-grid.test.tsx` | Donor retains monolithic route composition. |
| `/chat` | `3f1195d` | `src/routes/chat.tsx`; `src/workbench/fixture.tsx`; `src/routes/-chat.test.tsx` | Workbench provider and chat shell APIs changed; fixture data is reusable after a donor-native provider seam. |
| `/runs` | `61e73f8` | `src/routes/runs.tsx`; `src/runs/fixture.tsx`; `src/runs/source.tsx`; eight `src/runs/browser/*` and feedback consumer files; `src/routes/-runs.test.tsx` | Donor browser is monolithic, so the source-provider patch targets files that do not exist. |
| already present | pre-campaign | `src/routes/index.tsx`; `src/routes/grilles.tsx`; `src/routes/takeoffs.tsx`; `src/takeoff/proto/fixture-world.ts` | No fixture projection required. |

The campaign commits add fixture data, query parsing, provider or store injection, and focused tests. Their surrounding route composition imports the recipient's design-language and post-purge file topology. REJECT every raw class rewrite, token or primitive import, and target presentation hunk during projection.

## Out of scope

- Style adoption, design tokens, design-language primitives, raw class rewrites, and target presentation.
- Host, Revit, Computer Use, Vivaldi, installed, and live-session proof.
- A universal fixture framework or global fetch interception.
