# Pea context, memory, and workspace versioning review

Session capture: 2026-09-06 through 2026-09-07. This document separates user decisions, source findings, and proposed designs. It records the discussion, not an implementation commitment. The user had merged the context/capability changes after ruling on general ideas and spending substantial time on Scope/targeting; detailed review and personal Pea testing were still pending when this discussion began.

## User decisions and preferences

- Keep the established observation/reflection split of 75k/15k as the baseline. The user reports that this split worked well in prior use, strongly disagrees with Mastra's 30k raw-message default, and is considering roughly 100k raw messages. No threshold change was authorized or made here.
- Observational memory must retain useful conversation and task history. Generalizing everything from a relatively small raw window would lose continuity. The user questioned `runtimeEphemeralContextObserverInstruction` and suggested its generalization posture belonged more naturally in reflection.
- The intended versioning scope is one repository for the whole user `Documents/Pe.Tools` workspace. Separate repositories per Pod were not the intended default.
- Alternatives should be available, but branching out by default is not the user's preferred starting point. The user also sees merit in draft-first editing and explicitly left open whether JSON authoring should always occur on an alternative.
- Users are architects and engineers. They rarely want to review code. Comparisons should demonstrate functionality, including multiple script versions when a request is ambiguous.
- Apply must affect only the changes being reviewed. It must not activate unrelated unfinished work elsewhere in the workspace. The user confirmed: "yes I'd expect apply to do only my changes". Membership rules for overlapping edits within one file remain open.
- OneDrive is incidental Windows Documents placement, not a selected storage provider or a requirement. The user did not intentionally use it and discovered the redirected location only months after acquiring the computer. Do not require OneDrive coexistence or synchronization on that basis.
- Teach the current system from the big picture down, with actual snippets, path:line references, diagrams, dependencies, and control flow. An HTML explanation was deferred until after follow-up questions; none was requested for this capture.

## Current system explained in the session

The initial source survey used checkout `bb4b7f1` with a working tree that included concurrent changes. It was read-only. Its findings do not establish installed-product, provider, browser, or Revit behavior. Existing proof recorded by other sessions is separate evidence.

| Concept | Meaning and owner |
|---|---|
| Context | Static instructions, conversation, memory, workspace/skill material, and tool results available to the model. |
| World | Workspace identity, root, storage kind, and isolation description. `resolvePeaWorld` constructs `local-unversioned` with `isolation: none`; the Mesa schema has no constructor-backed implementation in this survey. |
| Scope | Thread-selected document and optional session pin. A turn receives a frozen Scope/revision through `pea.turn`; host calls resolve the session under that Scope. |
| Capability | A row with key, kind, description, needs, mutation flag, actor, and schemas. Ops, route documents, route commands, Pods, and bundled skills project into the catalog. |
| Permission | Tool-category allow/ask/deny policy. Availability, authorization, target resolution, and execution success are separate claims. |

Source anchors: `source/pe-tools/packages/runtime/src/pea-runtime.ts:120,130,191,494,600`; `source/pe-tools/packages/agent-contracts/src/world.ts:3`; `source/pe-tools/packages/agent-contracts/src/scope.ts:19,100,151`; `source/pe-tools/packages/runtime/src/scope-store.ts:81`; `source/pe-tools/packages/mcps/src/pea/capabilities.ts:37`.

```text
createPeaRuntime
  -> local world + Workspace filesystem/sandbox + bundled skills
  -> static instructions + TaskSignalProvider + memory/storage
  -> AgentController permission admission
     -> sendMessage -> admitTurn -> model/tool loop
        -> native workspace / skill / media / docs tools
        -> pe_find -> GET /pe/capabilities
        -> pe_read / pe_do -> runCapability -> dispatch
           -> op -> HostRpcCaller -> POST /call -> TS service or Revit bridge
           -> route -> shared route document / guarded command
           -> pod -> Pods route run command
           -> skill -> bundled skill text
```

- `pe_find` without filters returns a map, sessions, source outcomes, and Scope resolution. Queries return ranked rows and input schemas. Catalog sources have a 2-second budget and a 30-second cache per selector; its observation time is not a guarantee of current execution eligibility. See `capabilities.ts:170` and `capability-tools.ts:76` under `packages/mcps/src/pea`.
- `pe_read` finds the key, rejects human-only rows, rejects mutating rows, and dispatches other rows. The original chat diagram obscured the success branch; it did not reveal a code defect. See `capability-tools.ts:146,165,181,188`.
- `pe_do` uses the execute category. "Approval-gated" does not mean it always prompts: read-only denies, ask prompts, and trusted allows. See `packages/agent-contracts/src/thread.ts:1` and `packages/mcps/src/pea/index.ts:62`.
- Revit capability configuration is frozen at creation and defaults false. In the surveyed metadata only `capture_view` requires Revit; catalog and API-doc tools remain registered. The conditional instruction "Revit is connected" exceeds what a configuration flag alone proves. See `pea-runtime.ts:135,609`, `pea-instructions.ts:23`, and `pea/index.ts:62`.
- No automatic Pea current-document/view context signal is wired. The removed signal lacked a production producer and could replay stale state. Any replacement needs source, observation time, and clear-on-absence semantics. This is separate from preserving historical runtime events in memory. See `pea-runtime.ts:600`.
- Skills resolve under the product home's `.agents/skills`; overriding the workspace root does not relocate that skill directory. The runtime uses a contained file API and a local shell; this does not establish process isolation. See `pea-runtime.ts:191` and `packages/mcps/src/pea/skills.ts:336`.
- Memory/storage uses the Pea product-state profile; the default Windows database is beneath LocalAppData/Positive Energy/Pe.Tools/state, with an environment override. Scope heads and route documents use the native thread-state store. See `packages/runtime/src/storage/profiles.ts:115`, `scope-store.ts:35`, and `agent-controller-web.ts:191,343`.

## Memory findings and corrections

The research checkout `.explore/mastra` was at `9487796266` dated 2026-09-03, with `@mastra/memory` 1.28.3-alpha.1. Pea's installed package was 1.27.0. Defaults and recall registration were also checked in the installed bundle; the newer checkout is not blanket proof of installed behavior.

| Setting | Pea at review | Mastra source default |
|---|---:|---:|
| `observation.messageTokens` | 75,000 | 30,000 |
| `reflection.observationTokens` | 15,000 | 40,000 |
| `observation.bufferTokens` | inherited 0.2 | 0.2 |
| `observation.bufferActivation` | inherited 0.8 | 0.8 |
| `previousObserverTokens` | 1,000 | 2,000 |

Sources: `source/pe-tools/packages/runtime/src/memory/profiles.ts:11,46,94`; `.explore/mastra/packages/memory/src/processors/observational-memory/constants.ts:4`; `observational-memory.ts:587` in the same directory. Installed corroboration: `packages/runtime/node_modules/@mastra/memory/dist/src-aTfbkxBl.js:17042`.

- The observer's native prompt preserves detailed explanations, identifiers, technical results, collaborative text, user intent, and completion outcomes. Custom instructions are appended, so our durable-facts-only instruction conflicts with the native purpose. See `.explore/mastra/packages/memory/src/processors/observational-memory/observer-agent.ts:165,224,259,390`.
- Historical state is useful without remaining current truth: "we inspected A, tried X, received Y, and rejected Z" should survive. A past approval should be recorded without granting new authorization.
- Reflection reorganizes observations, preserves timestamps and completed outcomes, and retains more recent detail. Its escalating compression ladder can drop older procedural detail. Moving our instruction unchanged to reflection was an assistant proposal the assistant subsequently argued against, not a user decision. See `reflector-agent.ts:67,160` in the same source directory.
- 75k/15k is not a target compression ratio. Raw messages feed observations; accumulated observations eventually trigger reflection. With inherited buffering, background observation is triggered around 15k pending message tokens and normal threshold activation targets roughly 15k raw tokens retained, subject to chunk boundaries. Idle/provider changes can activate earlier. See `thresholds.ts:49,87` and `observational-memory.ts:589`.
- `lastMessages: 10` does not restrict the OM path to ten messages. OM loads messages relative to its observation boundary; the recent-message limit applies in the non-OM branch. This corrects the initial explanation. See `.explore/mastra/packages/memory/src/index.ts:1824`.
- `retrieval: { scope: "thread" }` already requests raw-history recall. It is distinct from semantic recall, which is disabled. Installed 1.27.0 registers `recall`; actual provider visibility and permission execution remain unproven in this session. See the installed bundle at line 30780 and the source `index.ts:2561`.
- Pea configures observational memory with `openai/gpt-5.4-mini`, working memory disabled, semantic recall disabled, and title generation disabled. Observer credential execution was not tested here. Do not conflate those settings with successful memory operation.

The assistant first suggested 75k/40k, then withdrew that recommendation after the user's experience with 75k/15k. Keep prompt correction separate from a possible 100k threshold experiment. The proposed minimal repair is deleting the custom instruction; a possible replacement would preserve episodes while marking runtime facts as historical and past approvals as non-transferable. No repair was applied.

## Mesa research and design frontier

Primary sources checked 2026-09-07: [versioning](https://docs.mesa.dev/content/concepts/versioning), [filesystem](https://docs.mesa.dev/content/concepts/filesystem), [introduction and platforms](https://docs.mesa.dev/content/getting-started/introduction), and [quickstart](https://docs.mesa.dev/content/getting-started/quickstart). Reverify SDK and platform details before implementation.

Mesa has Changes, optional Bookmarks, diffs, history, and branch/merge operations without Git's staging area. Writes amend the mounted change. Writers on the same change share edits; isolation requires another change. Durable writes do not choose useful task/checkpoint boundaries for Pea. These primitives can appear as ordinary editing, history, restore, and explicit alternatives rather than Git terminology.

| Candidate | Benefit | Unresolved cost |
|---|---|---|
| Shared current files with history | Least ceremony; explicit alternatives only when needed | Unfinished edits can affect consumers unless the editor retains a draft |
| Draft for every edit/task | Accepted state remains distinct from work in progress | Routine acceptance burden; task membership and promotion rules |
| Shared working draft plus explicit alternatives | Human and Pea co-edit normally; competing answers stay separate | Applying one set of edits must preserve unrelated drafts |
| Named alternatives as a primary surface | Functional comparison of ambiguous solutions | Too much visible machinery for routine work |

No candidate was selected. The assistant leaned toward shared work/history plus explicit alternatives, then explored shared drafts. The user remained interested in always-draft JSON authoring. A thread is not automatically a task or a permanent branch. One task may span conversations and one conversation may span tasks.

Apply can be implemented as an editor retaining a draft and applying its specific edits against the current document. "Only my changes" does not itself require a workspace branch or general authorship engine. The assistant's earlier assertion that a shared draft necessarily required a larger edit-membership system was narrowed accordingly. Within-file overlapping edits and stale draft reconciliation still need a rule. Human-requested Pea edits may belong to the same task; authorship alone does not settle membership.

Functionality comparison should show representative before/after behavior, affected-object counts, previews, validation, and assumptions. Example sheet-script alternatives: preserve existing names, normalize all names, or organize by discipline. Raw code is supporting detail. Saved bytes and validated behavior are different states. Workspace restore does not undo Revit mutation; comparing scripts needs an explicit preview, rollback, or separate-model strategy.

| Integration candidate | What it supplies | What remains ours |
|---|---|---|
| Mesa app filesystem | Cloud-backed file API and emulated shell in-process | Native local binaries and Revit do not automatically see those files |
| Linux FUSE filesystem | Shared real files for shell, compiler, and language server | Windows/Revit handoff and execution boundary |
| Local files with Mesa checkpoints | Fits the desktop's existing file access | Transfer, reconciliation, failure recovery, and external edits |

The local Mastra adapter explicitly does not mount Mesa into a sandbox: `.explore/mastra/workspaces/mesa/src/filesystem/index.ts:146`. It exposes change/bookmark operations at lines 493 and 500 and pins Mesa SDK 0.38.0 in its `package.json:34`; current web examples use a different construction API. Swapping only Pea's `LocalFilesystem` would not make its `LocalSandbox` share the remote files. Native mount and adapter compatibility were not tested.

The reserved `mesa-versioned` world contract couples storage to `bwrap` isolation. Separating storage and execution/isolation is an assistant proposal, not a new adopted contract. Workspace version and Revit Scope should remain distinct; a proposed run receipt links exact authored bytes to the actual Revit target and outcome. Earlier FUSE+bwrap proof requirements in the ledger are not silently superseded by this discussion.

The user questioned whether Mesa is worth the UX uncertainty and cited Git's TS API and cloud limitations. The assistant judged Mesa worth a bounded evaluation, not unconditional adoption. Apply semantics, overlap policy, and functional comparison are product problems under either backend. A small Git CLI integration remains feasible; cloud Git hosting is not equivalent to a mounted cloud workspace. Mesa's value must outweigh any custom Windows synchronization it requires.

OneDrive coexistence is not a requirement. Whether Mesa replaces local storage authority or versions local files remains an integration decision; do not mistake the current directory name for that decision. Offline behavior, external editors, and Windows access must be evaluated for the chosen shape rather than assumed.

## Proposed next evidence, not completed work

1. Review/remove or rewrite the custom observer instruction without changing 75k/15k in the same experiment. Exercise continuity after observation and reflection: exact target, failed attempt, rejected option, unresolved question, completion, and approval boundary. Prove recall can retrieve the original evidence.
2. If desired after that baseline, compare 100k/15k with 75k/15k using the actual model context budget and continuity behavior. Mastra defaults are not a reason to override the user's established split.
3. Evaluate Mesa with one workspace and one JSON editor. Apply a field edit while preserving an unrelated edit, inspect history, restore the document, then create one explicit script alternative with a functional comparison.
4. Prove that the editor, Pea file tools, shell/build tools, and Revit execution consume the intended same version, including after restart. Reconsider Mesa if this requires a disproportionate local/cloud synchronization subsystem.

This capture changed documentation only. It does not report a code fix, runtime verification, Mesa installation, cloud write, accepted backend, or settled draft UX.
