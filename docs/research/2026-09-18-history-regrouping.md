# History regrouping proposal

Proposal only, 2026-09-18. No product edits, history rewrite, integration, or implementation goals were performed. Eight independent Sol low reviewers examined bounded areas. This is a source/history review with representative code tracing, not an exhaustive correctness review or fresh runtime proof.

## Exact boundary

- Include `fb5643d6a15b9470273e55c3ad926850d99d6f99` through `784ab5bd87941cdf64ebf821480b62455a6c0195`.
- Because the start is a merge, use its first parent, `d9783288346c4340926a64dfa93c35a728b99a5a`, as the unchanged baseline. Include the side-branch work introduced by that merge.
- The range has 405 reachable commits: 344 non-merges and 61 merges, or 141 first-parent steps.
- The endpoint is on `crusade/normalize`. Current `main` is `850b8698347aa7501244ddb958aaee67e56c4f3e`, and is not its descendant. Their merge base is `4165a7988be3e4ae3a658ca525a48cffda845bfc`; main has one exclusive commit and the endpoint has 260.
- Endpoint tree: `b871c928fa076e962b3336761b95a1b82ab73f93`.

The net diff changes 1,777 files, adding 246,971 and deleting 84,635 text lines. Of these, 561 tracked `.artifacts` files account for 156,188 added lines. Docs account for 35 files; the other 1,181 files include code, fixtures, generated material, tooling, and miscellaneous files. Raw diff size substantially overstates product-code growth.

## Three approaches

| Approach | Proposed size | Benefit | Cost |
| --- | --- | --- | --- |
| Chronological milestones | 8–10 commits | Retains actual historical snapshots and makes the reconstruction relatively simple | Keeps superseded designs and mixes responsibilities inside each milestone; historical buildability still needs checking |
| Final-state conceptual commits | 16–18 commits | Best units for architectural review and later work; puts each surviving behavior beside its contracts and checks | Requires careful dependency reconstruction and sometimes splitting original commits |
| Broad goal groups | 10–12 commits | Less reconstruction than the conceptual option; recognizable Family, Takeoffs, RP, Chat, surfaces, Pods, workflow, AX, and evidence groups | Pods and workflow remain very large; chronological grouping alone cannot produce clean goal boundaries |

**Recommend final-state conceptual commits.** Do not preserve an implementation merely to demonstrate its later deletion. Preserve the rejected choice and reason in the relevant commit body or decision record, with the original history retained separately. The pod reviewer recommends keeping the early release model to make its reversal legible; that suits the chronological option, but it defeats the recommended final-state review structure.

Five commits would satisfy the requested count while doing little to make this range reviewable. Eighteen is a target, not a quota: combine groups whose dependency cannot be separated without artificial intermediate code.

The topology reviewer proposes excluding disposable evidence from the new history. That is a separate cleanup proposal: it cannot also satisfy exact endpoint tree equality. Preserve those bytes in the history-only rewrite unless the user explicitly chooses a changed final tree. Likewise, chronological milestone snapshots can preserve merged content; the hazard is flattening or replaying first-parent patches without accounting for merge results.

## Candidate 18-commit outline

These are ownership boundaries, not an executable rebase script. Exact hunk allocation and a valid dependency order are the next planning deliverable.

| # | Proposed subject and scope |
| --- | --- |
| 1 | Replace the Family model and native reconciliation engine. Portable contracts, capture, validation, planning, native apply, connectors, and preservation policy. |
| 2 | Replace Takeoffs geometry with Space capture and vector Partition. Keep HVAC materialization with its consuming pipeline. |
| 3 | Bind native calls to an exact document lifetime. Addresses, session/open identity, resolution, refusal attribution, and address refresh. |
| 4 | Give Work, Readings, and Actions authoritative owners. Revisioned edits, observable reads, semantic admission, durable receipts, and recovery. |
| 5 | Make routes and Ops project shared owners. Controllers, semantic controls, inspector/help projections, catalog-driven Ops, and Lab separation. |
| 6 | Share viewport, pane, rail, and keyboard geometry. Foundation plus consumer migrations, tutorials, Instances, and Runs layout adaptations. |
| 7 | Unify code, JSON, and diagram presentation. Shared read/edit surfaces, bounded highlighting, structured diagram contract, and consumers. |
| 8 | Let Chat render one transcript with one scroll owner. Dependency removal, navigation/follow behavior, attachments, images, and message actions. |
| 9 | Scope Chat drafts and expensive results by identity. Thread lifetimes, retained composers, loading boundaries, deferred-result retrieval, and stable readings. |
| 10 | Make pods portable folders of source. Identity, manifests, composition, vendored archives, import, final Documents layout, and bootstrap contracts. |
| 11 | Give members one editing and validation boundary. Host-local I/O, optimistic save, schema selection, field options, and the shared form/raw editor. |
| 12 | Run native entity operations from exact member sources. Family/families/schedule adapters, capture evidence, plan hashes, receipts, and script snapshot attribution. |
| 13 | Put entity routes on one workflow kernel. Route declarations, navigation state, capture/editor placement, confirmation sheets, and route replacement. |
| 14 | Move collaborative authoring toward thread-owned drafts. Canonical target head, family audit drafts, families proposals, scope/read budgets, and one apply control. |
| 15 | Make Pea use the same discovery and admission paths. Session-before-catalog resolution, CLI mutations, replay, actionable refusals, and generated guidance consumers. |
| 16 | Carry cancellation through host, bridge, scripts, and engines. Request dispatch, queue bypass, cancellation admission, settlement, and between-family checks. |
| 17 | Align checkout tooling and developer integration. SDK pins, actual build/dev-loop changes, solution/package wiring, and unrelated proof-tool repairs. |
| 18 | Preserve historical review and run evidence. Large recorded logs, screenshots, reports, and remaining bookkeeping, clearly labeled historical. |

Tests, fixtures, generated contracts, dependency changes, and live decision rationale belong with their behavior, not automatically in commits 17 or 18. The large Family group is the first candidate to split if it remains too difficult to review. Splitting it into model/capture and reconciliation/apply would make 19 commits.

## Distilled directions

These are the complete high-level themes identified by this review, rather than a claim to have audited every changed line. “Explicit” means a recorded ruling or stated architecture; it does not certify implementation.

| Direction | Evidence and boundary |
| --- | --- |
| One authority per fact and lifetime | Explicit RP doctrine; `3a47246`, `RouteWorkspace`, `Reading`, `ActionJournal`. Separate authored intent, observation, effects, navigation, and private widget state. |
| Durable address differs from execution identity | `1edbf0e`, `target.ts`, `resolveCallTarget`. Dispatch binds session plus `openId`; a remembered path is insufficient. |
| UI, Pea, hotkeys, and CLI share semantics | `38d0d82`, `semantic-actions.ts`, later shared admission builder. Projections must not redeclare policy. |
| Effects need honest recovery | `ActionJournal` preserves request identity and uncertain outcomes. Never manufacture success after interruption. |
| Libraries own domain meaning | Family contracts/reconciler, DocumentData, Space/Partition. Shells, palettes, host operations, and transport adapt those owners. |
| Purge competing authorities while preserving features | Explicit design-system and pod rulings. Removed names or lower LOC are insufficient acceptance measures. |
| Encode meaningful state distinctions | Separate member create/save and preparation refusal/success shapes. Do not replace boundary validation with type optimism. |
| Shared visual grammar owns geometry | `b92f980`, `247ba22`, `Surface`, `Pane`, `Rail`. Routes name regions instead of rebuilding layout and keyboard mechanics. |
| Machine payloads remain inspectable | `Code`, `JsonEditor`, structured diagrams, raw Ops output, visible invalid source and refusal detail. |
| Prefer direct projection over translation layers | Explicit assistant-ui reversal in `50e3f01`; keep runtime transcript authority while owning web rendering. |
| Identity governs asynchronous UI lifetime | Thread-keyed drafts, one scroll intent, exact deferred-result lookup. Late data must not cross thread boundaries. |
| Bound work and keep observed performance separate from claims | Catalog budgets, scoped family reads, deferred payloads, foreground browser measurement. Retention and virtualization are choices, not universal requirements. |
| Source bytes outrank reconciled release claims | Explicit pod reversal in `0b3f418`, implemented by `05c0e41`. Separate address, lineage, and derived content identity. |
| Publish portability without destroying composition | Vendor consumed foreign fragments; retain includes/presets. Nested references require rewriting, so universal byte identity is not the contract. |
| Validate the smallest useful unit | `$schema` selects meaning; one invalid member must not hide valid siblings. Offline structural checks differ from native semantic checks. |
| Capture, author, confirm, apply form a shared product loop | Entity kernel and one editor; preparation stays internal. Domain differences still need explicit treatment. |
| Pea and humans collaborate on the same draft | Explicit late ruling in `e13a9cc`; route-independent proposals and inline Chat projection remain partly aspirational. |
| Every run exposes its source and outcome | Member SHA, script snapshots, plan hashes, discoverable outputs and receipts. Memberless operations challenge the current common shape. |
| Native preservation outranks convenient normalization | Family atomicity, formulas, connector meaning, unmodeled capture evidence, dialog policy, explicit refusals. Capture/validate agreement alone cannot prove preservation. |
| Cancellation must reach the actual operation | `c587d06`, `57eda17`, `fd23da5`. Host and bridge must keep receiving cancel; engines cooperate only at safe boundaries. |
| Proof names the reality it exercised | Frozen seeds, deterministic checks, native sessions, and browser interaction answer different questions. Recorded reports do not prove current endpoint behavior. |

## Decisions to settle before new goals

1. **Saved member versus live draft.** Earlier rules require saved content; later rules make audit and collaborative authoring pod-independent. Define when persistence becomes mandatory before mutation.
2. **Shared workflow versus domain identity.** Schedule cell push uses positional grid/binding semantics; schedule-definition apply creates a schedule. Unifying these by vocabulary alone would lose meaning.
3. **One shape versus honest variants.** Endpoint `schedule-actions.ts:pushReceipt` uses empty member path/hash for a memberless operation. Decide a source model before spreading that receipt contract further.
4. **Single owner versus oversized owner.** `Pane`, `createRouteOwner`, and the entity kernel centralize many responsibilities. Fewer owners does not automatically mean a smaller or clearer public surface.
5. **Desired doctrine versus endpoint truth.** Surface competitors survive at this endpoint and are deleted by main-only `850b869`; thread targets and draft models are not universal; old Owed lines describe some completed work. Review code and ruling chronology together.

The Family review also identifies historical warnings about formula/type-cell preservation and incomplete native geometry. Those require fresh proof before being treated as current bugs or accepted limitations.

## Proposed execution after approval

First preserve original refs and a recoverable Git bundle, then reconstruct on a separate branch/worktree from the baseline. Make an original-commit-to-new-group accounting table, including superseded work and evidence-only changes. Require exact final tree equality with the endpoint above. Removing tracked evidence or fixing code would be a separately reviewed change.

Check each proposed intermediate commit in the lanes its changes require. If a boundary cannot stand without a shim, combine it with its dependency. Tree equality certifies the rewrite's result, not intermediate buildability or runtime correctness.

Then reconcile main-only `850b869` as a distinct integration step. Do not silently absorb it into the requested range or replace main with a tree that loses it. The branch/publication decision comes after a concrete reconstructed series exists.

Only then launch fresh design and implementation lines. Suggested line groups are authority/targeting; shared surfaces and keyboard behavior; Chat/plugin lifetimes; entity drafts and proposals; schemas/editing/field options; pod portability; receipts and recovery; native Family preservation; Takeoffs/Partition; cancellation; Pea discovery and scripting; and proof/tooling reliability. Expand a group only when its census finds independent ownership boundaries.

Each line receives the frozen endpoint, approved decisions, explicit counterexamples, its users/callers, preserved behaviors, and a falsifiable acceptance loop. Fresh agents should challenge the doctrine before extending it. Review agents should not become the implementation owners. The parent remains responsible for dependencies, disputed decisions, evidence, and integration, rather than fixing the product.

## Area reports

- [Foundation](../../.artifacts/handoffs/2026-09-18-history-review/foundation.md)
- [Shared surfaces](../../.artifacts/handoffs/2026-09-18-history-review/surfaces.md)
- [Chat](../../.artifacts/handoffs/2026-09-18-history-review/chat.md)
- [Pods](../../.artifacts/handoffs/2026-09-18-history-review/pods.md)
- [Entity kernel](../../.artifacts/handoffs/2026-09-18-history-review/kernel.md)
- [Native engines](../../.artifacts/handoffs/2026-09-18-history-review/engines.md)
- [Operations and cancellation](../../.artifacts/handoffs/2026-09-18-history-review/operations.md)
- [Topology and evidence](../../.artifacts/handoffs/2026-09-18-history-review/topology.md)

These area reports are local review evidence, not new canonical product instructions. Their grouping suggestions are alternatives; the consolidated recommendation above resolves overlaps and does not adopt every suggestion.
