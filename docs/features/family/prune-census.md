# Family consolidation prune census

Scope: post-consolidation dead-code and stale-documentation pass on `family-fresh`. The protected
`families.tsx`, `family.tsx`, `components/master-table/**`, `components/sentence.tsx`, and
`family/**` surfaces were not edited by this prune or included in its commit. No C# was touched.

## Deleted code and exports

| Deletion | Grep proof |
| --- | --- |
| `apps/web/src/lab/mock.ts` | Before deletion, `rg 'lab/mock' apps/web/src` found only `estimate.ts` importing `BBox`. `PAGE_W`, `PAGE_H`, `TableSpec`, `T1`–`T4`, `tableH`, and `cellBBox` had no consumers outside this file. Moving the four-field `BBox` shape into `estimate.ts` removed the last import. |
| `useSchemaQuery`, `useFieldOptionsQuery`, and `useParameterCatalogQuery` from `host/queries.ts` | A whole-web symbol grep returned only their declarations. Surviving settings consumers use `useTreeQuery`; `field-options.tsx` uses the dynamic host hook. |
| `LoadedFamiliesCatalogData`, `LoadedFamiliesMatrixData`, `ExcludedParameterReason`, `HostProbeData`, `SessionSummaryData`, `ExcludedFamilyParameterSnapshot`, `excludedParameters`, and `decodeMatrixData` from `host/loaded-families-view.ts` | A whole-web symbol grep returned only declarations and same-file implementation references. The surviving `/families` route imports `FamilyParameterSnapshot`, `FamilySnapshotRecord`, `LoadedFamiliesMatrixRequest`, `LoadedFamilyPlacementScope`, `visibleParameters`, and `cellText`, which remain. |
| Export status from `lab/estimate.ts`: `MdGrid`, `ParsedDocLike`, `parseMdTable`, `isSpanningRow`, `columnEdges`, `estimateCellBBox`, `lineBoxGroups`, and `matchRowBoxes` | `rg` found no references outside `estimate.ts`; they are now private implementation details. `RealTarget` and `buildTargets` remain exported for `family/doc-pane.tsx`. |
| Export status from `grounded-doc/engine.ts`: `FocusOrigin`, `BlockFocus`, and `GroundedDocStatus` | `rg` found no references outside `engine.ts`; they are now private implementation details. `GroundedDocEngine` and `useGroundedDoc` remain exported for the live views. |

Post-delete confirmation: a whole-web grep for every removed symbol and `#/lab/mock` returns no
matches (apart from the unrelated `cellBBox` property name on surviving `RealTarget`).
The loaded-families contract test had been the only non-production caller of `excludedParameters`
and `decodeMatrixData`; their assertions were removed while the same fixture continues to cover
the surviving `visibleParameters`, generated record shape, and render coercion.

## Deleted stale documents

| File | Proof it was stale |
| --- | --- |
| `docs/features/family/ops-mission.md` | Completed implementation mission brief; deletion was explicitly required by the prune mission. |
| `docs/features/family/prune-mission.md` | Completed, untracked prune mission brief; deletion was explicitly required. |
| `docs/features/family-sheet/PLAN.md` | Planned the deleted `/family-sheet` predecessor and linked the now-deleted `host/family-doc.ts`. |
| `docs/features/family-types/PLAN.md` | Planned the deleted `/family-types` route and `src/family-types/` UI. |
| `docs/features/family-types/LEDGER.md` | Open items assumed `/family-types`, `/family-audit`, `/family-doc`, `pdf-audit/`, and `lab/kit.tsx` still existed. |
| `docs/features/family-types/GROUNDING-WIRING.md` | Its fixed wiring contract named the deleted `/family-types` route and the deleted `/family-sheet` implementation as the rebuild target. |

Current documentation was corrected instead of discarded: the Family Model spec now describes
the authored/live `/family` lanes; Parameter Links records the retired iframe pilot; `SHIMS.md`
records the `lab/mock.ts` removal; the surviving FamilyFoundry language note now targets the
consolidated surfaces; and the CSS palette comment no longer names `/family-matrix`.

## Spared intentionally

| Surface | Reason kept |
| --- | --- |
| `routes/api/pdf-audit/parse.ts` and `parse.$parseId.ts` | Intentional shim. `family/doc-pane.tsx` and Pea commands fetch the parse lane/cache. |
| `packages/agent-contracts/src/family-types.ts`, `packages/mcps` handlers, and `FamilyTypesChatPlugin` | Intentional shim 7. Pea still consumes `route:family-types`; the contracts also supply schemas used by surviving family and parameter-links code. |
| `grounded-doc/**` | Every module has a live chain: `/doc-lab` and `/design-system` use the view, engine, and sample; the parse endpoints use the cache and types; `family/doc-pane.tsx` uses `ParsedDocView`; `ambiguous.ts` is used by the engine and its surviving test covers that behavior. |
| `lab/estimate.ts` | `family/doc-pane.tsx` imports `buildTargets` and `RealTarget`; only its dead public surface and fixture dependency were pruned. |
| `index.tsx` navigation | It links only to the surviving `/family` and `/families` surfaces; no deleted family-route destinations remain. |
| Shared `EmptyState` in `ops/primitives.tsx` | It has many surviving ops-view consumers. No hand-rolled duplicate remains outside protected family code. |
| `--cat-*` palette and CSS utilities | All six tokens have surviving consumers across grounded-doc, Parameter Links, RHVAC, workbench, ops, docs, and other routes. Only the stale route-specific comment was removed. |
| `docs/features/family-types/GROUNDING-LANGUAGE.md` and `GROUNDING-REVIT.md` | They retain source-indexed FamilyFoundry vocabulary and Revit API gotcha lore; neither claims the deleted route still exists after the wording correction. |
| Historical ADR/handoff references | They are explicitly dated evidence or use `family-document` as a domain condition, not live navigation claims. |

## Gates

- `pnpm exec tsc --noEmit -p apps/web`: **green** (exit 0).
- `vp check` on all surviving touched web source/test files: **green** (all 6 formatted; no
  warnings, lint errors, or type errors in the 5 analyzed TS/TSX files).
- `PE_LANE=dev vp test apps/web packages`: **green** (40 files passed, 1 skipped; 215 tests
  passed, 1 skipped).
- Full `PE_LANE=dev vp test`: **accepted exception only** (48 files passed, 1 skipped; 275 tests
  passed, 3 skipped). The two failures were the pre-existing `apps/host` flakes explicitly
  excepted by the mission: `boundary.test.ts` and `mastra-degrade.test.ts` each timed out at
  30 seconds. No web or package test failed.
