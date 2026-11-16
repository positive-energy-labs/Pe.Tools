# Converge shared foundation checkpoint

This is the first implementation checkpoint for C1-C6, not S4 acceptance. It descends directly from clean S0 `9537cac0`, whose sole parent is `5209e50c`. It carries no discovery implementation ancestry. The accepted [map](CONVERGE-MAP.md) and ADRs [0046](../../adr/0046-effect-identity-belongs-to-the-effect-owner.md), [0047](../../adr/0047-workflow-owns-durable-commands.md) and [0048](../../adr/0048-csharp-generates-effect-schema.md) remain authoritative.

The ask is a shared replacement owner connected to two consumers. The repository still gives ActionJournal all executable doors and keeps Work in files. This checkpoint builds and checks the replacement kernel without opening a second executable owner in normal host startup. `host-program.ts`, `command-registry.ts`, feature executors, public routes and native dispatch remain unchanged. No old responsibility is deleted.

## Responsibility gate and evidence

Before code, the fresh literal-call/import census at S0 found 210 candidate files and assigned all 79 transfer rows. The census records file hashes, line counts, exact matches and imports. Its scope includes host, web, CLI, MCP, runtime and contracts. Candidates are not independent runtime certification.

The shared run directory is `C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/converge-20261116-wave0/shared-foundation/`. It contains `GATE.md`, `census.json`, the reproducible census script and the final `RESULT.md`. The full protocol brief and non-author review remain in its sibling `protocol-review/CONTRACT.md` and `protocol-review/RESULT.md`. Keep the run while this checkpoint is used as evidence.

The gate is open for isolated shared-foundation implementation. S4 acceptance, replacement activation and S6 deletion retain their existing contract obligations. All F01-F15 remain acceptance obligations. Implementor tests below cover narrower kernel cases; the standing driver owns acceptance rows and decides what evidence carries.

E6-E8 belong to OD8: outward delivery, process launch and auth use a standalone committed started marker, then an outside invocation. After an uncertain marker, there is no automatic second invocation and no fabricated delivery. The outside-owner operation vocabulary is separate from keyed store operations. The three protected acts retain ADR 0038.

P4 retains literal indefinite queryability of compact authority in the active generation, under finite admission count/byte budgets. Allocation refuses at exhaustion. This checkpoint expires no safety identity and rotates no healthy generation. A missing reference never inserts or renews a row. Any later retirement follows ADR 0047. No new owner-default ruling is needed.

## What exists

| Contract | Implementation | Boundary still to connect |
|---|---|---|
| C1 | `agent-contracts/src/command-authority.ts` owns branded refs, inert tickets, invocation states, observations and owner outcomes. `runtime/src/command-invocation.ts` retains Allocated and SubmissionPending before submit; retry cannot allocate. Transport uncertainty carries the original ref. | Durable Node/browser/Page slot implementations and all actual producer conversions. Existing outbox code has not been reinterpreted or migrated. |
| C2 | `host/src/commands/service.ts` owns inert allocation, immutable descriptor/digest, SQL claims/order/plan acceptance plus `Workflow.execute(discard:true)` through one client/fiber transaction, duplicate observation, durable Stop and transitive stop-with-parent ancestry. RcMap shares concurrent preparation and retires with submit scopes. | Existing authenticated capability/live-lane/target adapters; resource-overlap FIFO, evidence-gated claim release, native cancellation and required descendant settlement. A sequence number alone is not the overlap scheduler. |
| C3 | One private `Pe.CommandWorkflow` tag and reference-only envelope; root gate precedes feature interpretation. The byte-closure primitive hashes supplied actual files/directories, answering Node executable and frozen configuration. Occurrence-based steps compare kind/key/input/target independently of Activity names. | A complete build/source/native/script closure producer and actual loader freeze/fence, build receipt verification and upgrade/crash matrix. The seal primitive cannot prove that a caller supplied the whole executable closure. Diagnostic build stamps are not substituted. |
| C4 | `program.ts` has native, keyed store, same-DB and OD8 constructors. Same-DB executes a statement supplied through the identical SQL client and decodes its result inside the inner transaction. Owner outcomes retain dispatch/uncertainty. Native schemas use the existing generated authority through the named temporary `fromStandardSchema` boundary. | Real SDK departure/evidence adapter and keyed canonical file-store operations. The Work API demonstration uses a stand-in owner and performs no real Work mutation. It is not same-DB Work. |
| C5 | `custody.ts` acquires a directory exclusively before DB inspection; stale custody refuses instead of guessing. Explicit virgin provisioning writes flushed pending intent, creates the header, then creates Active metadata. Missing/corrupt fence, restored header or a competing protocol owner refuse. `layer.ts` validates header/tables before engine construction. | Canonical Engine state-tree row; normal host startup cutover; crash custody recovery; ResetPending/archive/reconciliation/one-notice protocol; Windows power-loss ordering; old-binary deployment fencing. Reset is intentionally not exposed in this checkpoint. Provisioning after an interrupted create stays closed. |
| C6 | Count/request/claim/plan/step/logical-byte limits refuse new authority without deleting old rows. Accepted commands reserve logical capacity. SQLite page count bounds DB growth; `journal_size_limit` bounds a checkpointed WAL suffix. | Hard active-WAL growth control, measured engine overhead and physical Stop/terminal headroom under disk full, observer/history owner limits and shutdown proof. Merely specifying those candidate values does not certify them. |

One immutable descriptor and canonical SQL state/result columns produce observations. Engine messages own Activity results. There is no mirrored History journal, custom outbox scheduler, token service, compatibility migration or recovery callback per feature. Claims remain held until an evidence-aware release operation exists.

Tickets distinguish the exact echoed authored request from canonical execution intent, so server normalization does not require a producer-side normalizer. Shared reference checks reject mismatched retained and transport observations. Native/OD8 noncompleted failures carry their original occurrence, request and producer outcome. Command reads project recorded owner steps through Effect MessageStorage's exact execution/Activity key and decode its canonical reply, while missing results remain unresolved and corrupt replies refuse. No owner outcome is copied into the command row. The narrow F09/F14 tests inspect the exact stored Activity result and include reply corruption/removal controls.

The next coupled checkpoint is an admitted dependency basis plus evidence-bound conditional Work settlement. Fresh effect authorization and settlement of already proven consumed edits remain separate obligations. The current generic store gate must not be adopted for post-Stop settlement; no skipStop callback or per-feature recovery substitutes for that owner. SMELL-01/02 adoption holds remain until independent falsification, and the completed-prefix projection above is only part of SMELL-03's evidence-reference contract.

`proving-programs.ts` exercises the concrete generated-schema API shape: repeated carrier initialization before `rooms.draw`, and multiple frozen `families.apply` leaves with a separate conditional-retirement owner operation. The generic program has no feature branches. These programs are not yet wired into the existing feature admission/seal/readback/publication seams.

## Limits candidate

| Quantity | Candidate |
|---|---:|
| Inert plus accepted ticket rows | 1,024 |
| Lifetime accepted commands / concurrently active commands | 32 / 16 |
| Reserved safety rows | 8,192 |
| Request / plan / step bytes | 64 KiB / 256 KiB / 128 KiB |
| Claims per command / bytes per claim | 64 / 1 KiB |
| Steps per command | 64 |
| Logical reserve per accepted command / total authority bytes | 16 MiB / 512 MiB |
| Engine DB / checkpointed WAL suffix | 1 GiB / 64 MiB |
| Native FIFO / observers / observer buffer / history suffix | 64 / 64 / 32 / 256 |
| Shutdown / entity termination | 5 seconds |

These are review candidates, not measured production batch capacity. Actual acceptance may hit the byte ceiling before a count ceiling. Tests use smaller count limits to reach overload and preserve Stop and original refs; the repeated-carrier/multi-leaf sample is small. Neither sample establishes the largest production family batch or room loop. No producer should adopt this owner until the C6 remainder above is addressed.

## Checks and next connection

The narrow compile surface is `vp exec tsc --project apps/host/tsconfig.foundation.json` from `ts`. The narrow host-only boundary suite is `vp test run --config apps/host/vite.foundation.config.ts`. It uses the replacement layer graph, real Effect 4.0.2/SQL/SQLite, isolated files and stand-in native/outside/Work owners. Its exact output, source SHA and observed paths belong in the run receipt. No full suite, route generation, native session, SDK write or actual HTTP/Page/MCP/CLI drive is part of this checkpoint.

The earlier whole-host typecheck could not resolve ignored route-closure outputs in this fresh worktree. It also identified the first new-code type errors, which were fixed under the narrow configuration. There is no claim that the whole-host check is green or that missing generated inputs were independently reproduced on the base.

The initial estimate was 1.5 writer-hours, without a measured rate. The post-census production estimate is 6-10 writer-hours and roughly 1,800-3,000 lines, plus independent native work. It is not a cap. The next phase connects the canonical file owners and exact byte-loading/custody protocol before changing the two existing proving-consumer doors. Keep this coupled implementation ownership across review rounds. Integrator owns branch landing/builds and driver owns acceptance; non-author contract review remains required.
