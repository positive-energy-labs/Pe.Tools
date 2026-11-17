**Outcome:** PROVEN[deterministic + compile + artifact, P4-move-evidence/receipt.json, 86c02c98d76fdac87ed047630eba689f4698b342, 2026-11-17T08:03:53.449946+00:00]. The cuts, move, flatten, strays, scaffolds, generation, P-010 and P-034 are implemented. No new reds. Two relocated Plan-wait journeys remain red on untouched 1999f3fa too.

**Readback:** Keep the fan mint and evidence behavior, repair the native-door fixtures, put the three products in twelve packages with src/, preserve wire values and guide text, and carry the handoff regression through both integration merges.

**Did:** Branch crusade/fans-P4-move. Checkpoint 3efd2b57a3e5ecddd5212a40511ed67594bd81ec. Merge 9a4b646b with 4288034c05ba91112375a6114d2e260d111a57d5; merge 1999f3fa with 4ba9b2cd7d182ade63d667889ebc03b738ff84fa. SDK beta.224. Implementation tip 86c02c98d76fdac87ed047630eba689f4698b342. The report/evidence-only commit follows this tip.

**Ran -> saw:** All 19 touched/new package typechecks exit 0, including three domain packages without DOM libraries. The normal codegen:routes task projects 18 routes and three exported executor groups. Focused guards: 3 files / 7 passed. Product names remain report-only: 43 generic files / 528 mentions. Boundary scan: 666 production product edges / zero violations / zero forbidden paths. Host read-contract census: 1 file / 7 passed. Final frozen prefer-offline install exits 0.

| Package | Files | Last tests | Exit |
| --- | ---: | --- | ---: |
| products/fans/host | 6 | 37 passed (37) | 0 |
| products/fans/web | 34 | 2 failed ; 99 passed (101) | 1 |
| products/duct-systems/web | 15 | 61 passed (61) | 0 |
| products/ducts/web | 16 | 52 passed ; 1 skipped (53) | 0 |
| products/ducts/host | 3 | 9 passed (9) | 0 |
| products/duct-systems/host | 1 | 2 passed (2) | 0 |
| products/ducts/contract | 1 | 5 passed (5) | 0 |
| products/fans/contract | 2 | 12 passed (12) | 0 |
| products/ducts/domain | 21 | 119 passed (119) | 0 |
| products/duct-systems/domain | 4 | 9 passed (9) | 0 |
| products/fans/domain | 16 | 98 passed (98) | 0 |

Before: 117 files / 503 cases (494 passed, 8 base failures, 1 skipped). After: 119 files / 506 cases (503 passed, 2 untouched-base failures, 1 skipped). The handoff adds one case in an existing file. STRAYS adds two files/two cases; its support file is not a test. The native-door fixture repair makes all nine cases pass. The two stray failures reproduce at planPending assertions 204 and 256 on untouched 1999f3fa; see p4-stray-untouched-tests.log. They are carried under the no-new-reds ruling.

The normal host Vite config and kit setup were used throughout final host proof. The final fans host suite took 593.14s, with 547.18s reported in tests; kit duration was not measured separately. No temporary host config was used for final evidence.

**Kept wire values for P4-wire:**

- `CALC_ENGINE_VERSION = "sheet/4"`: `ts/products/fans/domain/src/calc/types.ts`.
- `CALC_GROUP = "sheet"`: `ts/products/ducts/domain/src/calc/scoped-snapshot.ts`.
- `calc read id = "fans.sheet"`: `ts/products/fans/contract/src/contract.ts`.
- `fanCalcBreakdown read id = "fans.worksheet"; ductCalc read id = "ducts.sheet"`: `ts/products/fans/host/src/fan-calc.ts`.
- `Work key / route key "ducts"; pane/stage ids; sheetPath / sheetView / sheetSnapshot wire properties`: `ts/products/fans/web/route.ts; ts/products/duct-systems/web/route.ts; ts/products/fans/contract/src/fans.ts; ts/products/ducts/contract/src/ducts-calc.ts`.
- `FAN_CALC_GUIDE text / read ids`: `ts/products/fans/contract/src/calc-read.ts`.
- `recording metadata wire values`: `ts/packages/agent-contracts/src/input-occurrence.ts; ts/packages/agent-contracts/src/native-recording.ts`.
- Route pane/stage ids remain in both root route.ts files. Persisted Work/route keys and sheetPath/sheetView/sheetSnapshot properties stay byte-identical in value. Generic sheet commands, recording metadata and route-document-store.ts keep their protocol.

**Guide paths for P4-guide:** `ts/products/fans/web/src/calc/closer.ts` keeps SHIM(ducts-sheet-write); `ts/products/fans/contract/src/pea/ducts-skill.ts` has unchanged template text; `ts/products/fans/contract/src/calc-read.ts` holds FAN_CALC_GUIDE. The generic MCP instructions.ts and skills.ts prose is untouched. All ten native recording JSON blobs are byte-identical to the base.

**Rehomes:** Every manifest deviation is enumerated in the committed `.artifacts/p4-manifest-rehomes.json` (197 rows), with the full mapping in `.artifacts/p4-final-mapping.json`. They include the src/ flattening, root route.ts declarations, shared contract/input/snapshot/layer types, fan-link and guide contracts, fan network-calcs and read contracts, shared calc-runs projection, shared presentation options/types, system-owned web adapters, and three fan-write host tests. FLATTEN moved 195 files and rewrote 229 export paths. STRAYS moved both shell tests and their support file into fans/web/src. Web route.ts stays at package root because routeFolderCandidates enumerates each product's web directory directly.

**Line gauge:** +158 net production TypeScript vs 1999f3fa, excluding renames, tests/fixture/support files, generated output and configs. The cuts contribute +152; the remaining composition/generation/rehome work contributes +6. Growth is in published contract boundaries and generator/adapter declarations; split algorithms were not copied. Script-generated manifests and test/TS configs are separately +859 net. The executed move and flatten scripts are committed under .artifacts; this is the committed-script choice in the brief.

**Post-flatten tree** (`git ls-files ts/products`, strip final path segment, unique sort):

```text
ts/products/duct-systems/contract
ts/products/duct-systems/contract/src
ts/products/duct-systems/domain
ts/products/duct-systems/domain/src
ts/products/duct-systems/host
ts/products/duct-systems/host/src
ts/products/duct-systems/host/src/tests
ts/products/duct-systems/web
ts/products/duct-systems/web/src
ts/products/duct-systems/web/src/network
ts/products/duct-systems/web/src/screen
ts/products/ducts/contract
ts/products/ducts/contract/src
ts/products/ducts/domain
ts/products/ducts/domain/src
ts/products/ducts/domain/src/calc
ts/products/ducts/domain/src/fixtures
ts/products/ducts/domain/src/fixtures/catalogs/price-lbp
ts/products/ducts/domain/src/kernel
ts/products/ducts/host
ts/products/ducts/host/src
ts/products/ducts/host/src/tests
ts/products/ducts/host/src/tests/fixtures
ts/products/ducts/host/src/tests/native-recordings
ts/products/ducts/web
ts/products/ducts/web/src
ts/products/ducts/web/src/calc
ts/products/ducts/web/src/encoding
ts/products/ducts/web/src/fixtures
ts/products/ducts/web/src/fixtures/ashrae
ts/products/ducts/web/src/screen
ts/products/fans/contract
ts/products/fans/contract/src
ts/products/fans/contract/src/pea
ts/products/fans/contract/src/tests
ts/products/fans/domain
ts/products/fans/domain/src/calc
ts/products/fans/domain/src/calc/fixtures
ts/products/fans/host
ts/products/fans/host/src
ts/products/fans/host/src/tests
ts/products/fans/host/src/tests/native-recordings
ts/products/fans/web
ts/products/fans/web/src
ts/products/fans/web/src/calc
```

**Not verified:** UNPROVEN[no native Revit or browser drive; no installed build]. No full workspace suite/build or mutants ran.

**Blocked:** None. The two base-red stray journeys are explicitly carried, not claimed green.

**Next:** Parent integration and non-author review, then P4-wire/P4-guide/P4-docs-guard use the final paths and preserved constants above.

**Where:** Full logs, hashes, mappings and receipt are in `C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/fans-20261116/wave/4/P4-move-evidence`. The temporary base worktree and its long-path dependency remnants have been removed. No owned Revit session or persistent server remains.
