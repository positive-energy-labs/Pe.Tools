# Code-quality sensors: PoC verdicts

Six GPT-5.6 Sol agents at medium reasoning built isolated PoCs in two waves of three. The parent replayed all six proof scripts and challenged their conclusions with additional counterexamples. Source was pinned to `850b8698347aa7501244ddb958aaee67e56c4f3e`. These are adoption recommendations, not installed policy. Product code, factory configuration, and the factory ledger were not changed. No Revit or browser runtime claim is made.

This follows the [research synthesis](2026-09-17-measuring-code-quality.md) and the factory-map distinction between sensors and interpretations. “80%” means a small portfolio with high expected value per cost; this experiment cannot establish a measured percentage of all defects caught.

## Main result

**Adopt precise contract checks and independent behavioral falsifiers first. Keep structural and historical measurements descriptive until their relationship to a concrete failure is established.** Minimal code is not necessarily short code; the target is fewer independent decisions, fewer exposed promises, and fewer ways for state to become inconsistent.

The strongest finding came after the mutation experiment passed. A separate probe against the real `ApsPathGlobMatcher` source found that literal paths containing `__DOUBLE_STAR__`, `__SINGLE_STAR__`, or `__QUESTION__` become wildcard patterns. All three incorrectly match `literal/x.rvt`; an ordinary literal does not. The implementation uses these strings as intermediate replacement markers. The source-linked console probe exits 1 as an expected red result. No product repair was applied.

This is a deterministic defect in the helper's literal matching behavior. It is not a claim about observed production impact. The ten-invariant suite killed all five selected non-equivalent mutants but missed this different mechanism. Mutation sensitivity is useful evidence; it is not an independent specification.

## Adopt / kill

| PoC | Verdict | Evidence and adoption boundary |
|---|---|---|
| Portable C# dependency boundary | **Adopt a narrow gate** | A Roslyn compilation analyzer rejects the actual installed `RevitAPI` assembly in a portable fixture, ignores textual lookalikes, and accepts the real portable package. Initial fake assembly identity was wrong; real metadata corrected it. Use explicit package policy. |
| SDK analyzers and documentation diagnostics | **Adopt selected rules; report first** | Real `Pe.Shared.RevitData` build produced 30 active diagnostics and one suppressed result. Two XML documentation references are ambiguous/unresolved. The inspected project had analyzers disabled. Compiler documentation warnings are not necessarily new because analyzers were enabled. |
| All recommended analyzer warnings as one gate | **Kill** | Most findings were naming/style: 11 CA1720, 8 CA1805, 5 CA1716. Explicit false initialization and generic static helpers are not inherently defects. |
| Blanket WindowsBase reference ban | **Kill** | A legitimate net8 fixture receives the assembly implicitly. A UI-safety rule needs used-symbol/context semantics, not this reference blacklist. |
| TypeScript strict indexed access and exact optional properties | **Adopt incrementally** | Seeded fixtures expose unsafe indexing and absent-versus-undefined mismatch. A small real slice has baseline zero errors and two TS2379 errors with stronger flags. Whole-repo cost and migration volume remain unmeasured. |
| React compiler diagnostics | **Adopt advisory** | Two seeded mechanisms detected, legitimate external subscription left clear. Official ESLint rules found 26 diagnostics in 46 sampled real files. Several effect findings require ownership/SSR interpretation, so no bulk autofix. |
| Additional ESLint stack solely for those React checks | **Kill** | Already-installed Oxlint 1.70.0 has `react/react-compiler`. Parent replay catches both fixture failures. Same 46-file input yields 62 diagnostics: 24 EffectSetState, 2 Immutability, 23 Refs, 12 MemoDependencies, 1 StaticComponents. Extra families are untriaged. Counts agree for the two shared families; exact equivalence was not established. |
| Import graph and exposed-symbol inventory | **Adopt descriptive output only** | 707 TS files, 1,469 resolved edges, 2,596 unresolved references, three computed dynamic imports. Output is correctly partial. Useful for navigation and review scope; insufficient for dead-export deletion. |
| Blanket packages-to-apps import prohibition | **Kill this policy** | The real hit is an integration test importing a host test fixture. That is not proof of a production boundary defect. Separate tests, generated code, and production policy before gating. |
| Handwritten API signature hash | **Kill** | Parent changed a named parameter interface member from number to string; the original hash called it implementation-only. The agent removed the hash instead of growing an unreliable type serializer. |
| Domain invariants plus targeted mutation | **Adopt** | Three weak checks passed five bad mutants. Ten stronger invariants killed all five; one observably equivalent candidate survived. Missing/invalid mutations now fail the proof. Add independently chosen edge cases, illustrated by the real marker-collision defect. |
| Timing slope as a complexity/performance gate | **Kill for now** | Regex pattern-count sweep was descriptive and approximately linear. No deliberately slower implementation or controlled benchmark established sensitivity. Keep workload and distribution data, not an asymptotic claim. |
| Churn, dispersion, and co-change | **Adopt investigation view** | 150 non-merge commits; 143 analyzed, seven bulk commits unknown; 344 authored files and 122 support-qualified pairs. Synthetic formatting creates spurious co-change; filtering removes it and preserves a rename-aware pair. Real high signals largely describe migrations and intentional documentation/test coupling. |
| Churn/entropy/lift as defect or architecture gate | **Kill** | Small new files inflate relative churn; tests should co-change with code; broad commits can be valid contract migrations. These readings lack an outcome-calibrated threshold. |
| Finding identity plus multiplicity | **Adopt a narrow ratchet improvement** | Count remained one while one finding was replaced elsewhere. Identity delta caught removal/addition; line shifts stayed stable; duplicate occurrence changed multiplicity. Same-file replacement and rename identity remain unsupported. |
| Coverage, failure, and provenance receipt | **Adopt the fields** | Real reading: 399 analyzed, 76 excluded, zero failed, 16 raw-table matches, explicitly partial. Empty input and tool failure refuse success. This says what was measured, not whether the application is good. |
| Receipt validator as freshness proof | **Kill current implementation** | Parent changed recorded content and tool hashes to nonsense; validator still exited zero. It checks commit/config but does not recompute content or compare the tool hash. Recording provenance is not validating it. |
| Raw `<table` regex as library-quality rule | **Kill** | Useful only as an existing-rule demonstration for receipt mechanics. A syntax count cannot establish component correctness, accessibility, or good abstraction. |

## What makes a good sensor

A reading is a deliberately lossy projection of code. If a damaging change and an acceptable change yield the same reading, that reading cannot distinguish them. The API hash, count-only ratchet, and stale receipt demonstrated this directly.

For each proposed sensor, require six things:

1. **A named failure mechanism.** “A portable package imports a host-only assembly” is testable. “This file is complex” is an interpretation.
2. **Sensitivity to a damaging change.** Seed a realistic negative control. A green test without a red control may simply measure nothing useful.
3. **Invariance to harmless changes.** Line movement, comments, formatting, and legitimate external subscriptions must not create the corresponding failure signal.
4. **An explicit observation boundary.** Report analyzed, excluded, unresolved, and failed inputs. Zero findings on zero files is not clean. A sample of 46 files is not all 475 TS/TSX web inputs.
5. **A localized decision.** A finding should identify the contract, path, symbol, or reproducible input that supports a repair. Separate raw observations from recommendations.
6. **A cheap, trustworthy replay.** Include source content, tool/config identity, workload, and expected exit semantics. Check provenance when consuming a receipt; do not merely print hashes.

In control-theory terms, a sensor cannot observe a state distinction that its output erases. Several independent mechanisms are more valuable than many correlated size/complexity counters. Goodhart-style pressure matters: gates on raw counts reward moving, suppressing, or compressing code. A gate should fail for the behavior you want to prevent, not an easy-to-game correlate.

Information theory helps describe change dispersion; it does not turn Shannon entropy into a universal code-quality measure. Git co-change is a relationship between recorded changes, not proof of causal coupling. Systems thinking helps place boundaries and identify amplification; it does not establish that every deeper dependency chain or prop path is harmful.

The same reading may support either observability or a gate. A dependency graph answers “what depends on this?” A separately declared forbidden edge makes part of that graph actionable. Keep that policy outside the raw reading. This is consistent with the distinction between symptoms and internal causes in [Google SRE monitoring guidance](https://sre.google/sre-book/monitoring-distributed-systems/).

## Minimal portfolio and near-free additions

Start with existing compiler/type checks, selected native diagnostics, declared portable boundaries, and a few domain invariants with independent edge cases. Add graph/history/coverage views to direct review effort. Do not build a composite quality score or a controller around these prototypes.

- **Run existing guards at the merge boundary.** Parent ran `vp run @pe/repo-guards#test`: 94 tests in five files passed. The inspected `Compile.yml` runs doctor and C# builds, not these TS guards. Confirm the full CI topology before adding a duplicate job.
- **Use the installed React rule.** Native proof is retained below. Start as advisory because the combined rule contains additional categories and the compatibility documentation identifies experimental support. See [Oxlint plugins](https://oxc.rs/docs/guide/usage/linter/plugins) and [compatibility](https://oxc.rs/compatibility).
- **Use declared API reports instead of custom type hashing.** Evaluate [PublicApiAnalyzers](https://github.com/dotnet/roslyn/blob/main/src/RoslynAnalyzers/PublicApiAnalyzers/Microsoft.CodeAnalysis.PublicApiAnalyzers.md) for C# and [API Extractor reports](https://api-extractor.com/pages/overview/demo_api_report/) for TS. This is an untested suggestion. An intentional surface diff aids review; it need not freeze greenfield compatibility.
- **Compile a tiny consumer example for each important public operation.** It directly exercises discoverability, construction burden, and the shortest supported path. Automated compilation proves usability at the type level; a human still judges whether names and concepts are intuitive. Not PoC-tested here.
- **Reuse documentation compiler diagnostics.** The real C# build already exposed two broken references. Favor executable examples and checked links over a prose-quality score. Verify each project's effective [analyzer configuration](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview) before assuming defaults.
- **For runtime transparency, expose existing latency distributions, errors, retry counts, queue depth, and expensive-operation counts with workload/context.** React render counts and allocation data are investigation inputs. No runtime instrumentation or performance improvement was proven in this exercise.

Autofix should stay narrow: formatting and proven semantics-preserving native fixes. Effect removal, interface collapse, dead-export deletion, and dependency relocation need behavioral evidence and review. A sensor output alone does not authorize them.

## Reproduction and retained evidence

All six worktrees are siblings under `C:/Users/kaitp/source/repos/`. Each lane has its code, `REPORT.md`, receipts, and `proof.ps1` at `.artifacts/runs/sensor-poc-20260917/<lane>/`. Run the script from that worktree root. These are local ignored artifacts, not committed or portable packages; absolute dependency paths and SDK/package versions are recorded by the lane reports.

| Worktree | Lane | Parent replay |
|---|---|---|
| `Pe.Tools-sensor-csharp` | `csharp` | Exit 0; real assembly boundary, lookalikes, malformed input, portable project |
| `Pe.Tools-sensor-surface` | `surface` | Exit 0; barrel/type-only/resolver fixtures; empty and malformed exit 3; real graph partial |
| `Pe.Tools-sensor-react` | `react` | Exit 0; official rule fixtures and strict TS slice |
| `Pe.Tools-sensor-behavior` | `behavior` | Exit 0; five killed, one equivalent survivor, zero invalid/timeouts |
| `Pe.Tools-sensor-history` | `history` | Exit 0; bulk-change confound, spaces and rename handling |
| `Pe.Tools-sensor-observe` | `observe` | Exit 0; identity/coverage fixtures. Does not validate freshness; parent counterexample supersedes that implication |

Parent evidence is under the original checkout's `.artifacts/runs/sensor-poc-20260917/parent-probes/`:

- `glob/Probe.csproj`, `glob/Program.cs`, `glob/results.json`, `glob/exit-code.txt`: real source-linked literal-marker counterexample. Replay with `dotnet run --project .artifacts/runs/sensor-poc-20260917/parent-probes/glob/Probe.csproj -p:ImportDirectoryBuildProps=false -p:ImportDirectoryBuildTargets=false --configuration Release`; expected exit 1.
- `surface-before-review.mjs`, `before.json`, `after.json`, and fixture directories: retained falsified API hash.
- `proof-native-react.ps1`, `oxlint-react.json`, `oxlint-react-results.json`, `oxlint-react-real.json`: built-in alternative and real sample.
- `tampered-receipt.json`: pass to the observe lane's `validate.ps1` with its worktree as `-Repo`; it incorrectly accepts the corrupted fingerprints.

Independent replay proves these bounded mechanisms, not general maintainability, production fault rates, Revit safety, or speed gains. The priority for a next implementation is to promote the smallest proven rules into existing tooling and discard the losing prototype machinery.
