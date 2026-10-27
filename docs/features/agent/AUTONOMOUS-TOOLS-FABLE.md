# Autonomous tools: Astra and Fable workshop proposal

Status: **IMPLEMENTATION AUTHORIZED by the user on 2026-10-26.** The source workshop below records the agreed design; implementation evidence and limits are recorded in ADR 0024 and the agent ledger. Source reasoning only: no build, no test, no Revit, no browser ran. Written 2026-10-26 against main `0b40c293` (dirty) and the uncommitted worktree `t3-write-countdown`. The workshop was untracked when written; earlier rounds exist only in chat, and §8 keeps the alternatives that still matter.

Final synthesis by Astra after three Fable rounds. The shared design is Work, command execution, and run consent with separate owners. Fable rejected a second execution engine; Astra accepted reuse of `ActionJournal`. Astra rejected document-widening prompts, actor-owned edit slots, and cache invalidation as write authority; Fable accepted those corrections. The remaining adapter and native proof obligations below are implementation blockers, not extra user approval steps. The code sketches specify boundaries; they are not complete compilable contracts.

## 1. Two accounts

**The ask.** A tool open on Work bound to a target is writable by the human and by Pea, regardless of which thread targets what. Pea's first consequential write in a turn asks once, with a 60 s deadline; that answer covers the rest of the turn across tools and documents. Human presses never ask. Grants, per-document widening, the proposal rung, human-only actions and thread-target authority go at the base.

**What the terrain shows.**

| Fact | Where |
|---|---|
| One caller context per harness spawn: `mintContext({kind:"pea", thread})` into the child's env. The MCP server, the shell and every `pea` CLI child inherit it. No turn is in it | `host/src/harness/threads.ts:1043-1044`, `control.ts:82-86`, `mcps/src/stdio.ts:12-19`, `runtime/src/invocation-context.ts:88-91` |
| `t.running` is set at prompt start and cleared after the prompt resolves; permission requests and ACP updates are stamped with it at receive time | `threads.ts:1429`, `:1519`, `:1068`, `:1054` |
| The MCP server wraps every tool: `beforeTool` hook, then a per-JSON-RPC-request tool-call id | `mcps/src/server.ts:54-59` |
| `ActionJournal.admit` dedups by id and canonical identity, blocks overlapping destinations, creates the row `running`, exports the admission, runs `prepare` then `execute` in one chain, persists each step before and after its effect | `host/src/action-journal.ts:517-590`, `:715-730`, `:690-713` |
| Family apply's freshness checks live **inside prepare**: spent-plan check, consumed staged cells still equal, `assertFresh` on document marks. Execute retires consumed cells only after native success, and only those still unchanged | `host/src/family-actions.ts:545-581`, `:940`, `:1066-1080` |
| `requireEligibleCaller` is the only actor gate on a Family action | `family-actions.ts:423` |
| The browser runs plan then apply as two host workflows; the confirm sheet is optional; `byPlan` folds row hashes into the apply input | `web/src/route/entity-route.ts:352-389`, `route/workflow.ts:27-38`, `:46-92` |
| Trichotomy: only Pea proposes (`persistedProposal` refuses any other `by`), humans stage, masks enforce it | `agent-contracts/src/trichotomy.ts:1-38` |
| `ActionDefinition = says, dirties, needs, actor, input`; the worktree adds `mutates` | `agent-contracts/src/semantic-actions.ts:24-30` |
| Worktree: `holdWrite` is per thread and per write, reads `t.running` at hold time, and `awaitHold` runs **before** `admit`, so a waiting write has no receipt | worktree `threads.ts:757-776`, `call-route.ts:187-195` |
| The takeoff client already recovers a prior attempt by `requestId` before submitting a new one | `mcps/src/shared/host-rpc-caller.ts:207-231` |
| `admitCrossing` serves three principals: pea (thread targets), page (bound page door), external-mcp (paired device plus targets) | `control.ts:431-555` |

**Where they differ.** The ask has one gate (run consent) and one kind of author. The terrain has four gates and two authors, but it already owns the durable command, sealed preparation, typed steps, overlap block and revision fence. The change is: delete the Pea gates, give the journal one waiting state, give the harness one per-turn consent, and give Work one author-neutral change type. Nothing new is built beside the journal.

## 2. The model

```
harness turn (RunConsent)  ◄──  ActionJournal row (Origin, Footprint, steps)  ◄──  domain handler (footprintOf, prepare, execute)
   thread log → ChatShell card         receipts Reading → kit CommandState          effect adapters: bridge, pods, files
```

Two owners of two facts, linked durably: the harness owns the run decision; the journal owns each command and records the exact decision that authorized it. Normal completion preserves that evidence. Explicit Stop still cancels pending commands and prevents their remaining mutations at execution checkpoints; an authorization record does not exempt a command from cancellation.

### 2.1 Origin keeps the principal

```ts
/* agent-contracts/src/caller.ts: Caller is unchanged (host-minted, transport-bound). */
type RunRef = { thread: string; turn: string };
type Origin = { caller: Caller; run: RunRef | null; toolCall?: string };
```

`caller` is what `callerOf` mints today (`control.ts:128`). `run` is set only by the host, only from a run token (§4). Basis is deleted for Pea; Page and external-mcp keep their doors (§6).

### 2.2 RunConsent: one record per turn, decision kept after the turn ends

```ts
/* host/src/harness/threads.ts; durable through the thread log. */
type AllowDecision = { id: string; by: "human" | "deadline"; at: string };
type RunConsent =
  | { state: "idle" }
  | { state: "waiting"; requestId: string; deadline: string; commands: string[] }
  | { state: "allowed"; decision: AllowDecision }
  | { state: "closed"; reason: "completed" | "stopped" | "restart";
      decision: AllowDecision | null; at: string };
```

Transitions: `idle -> waiting -> allowed -> closed`. A human answer or deadline resolves the one pending request, after its event is persisted. Further commands use the same decision. Completion closes new admission but permits already-authorized bounded commands to finish. Completion while still waiting cancels unapproved commands; it never auto-approves them. Stop closes admission and cancels pending and queued mutations, including those of already-authorized commands. Dispatched effects report their actual outcomes. Label the card's negative action **Stop writes for this turn**; this scope is our recommendation, not a previously supplied user ruling. Cancelling one command never stops the run's other commands.

### 2.3 Command: the journal row plus `waiting`

```ts
type ActionReceipt = {
  /* existing: id, kind, key, destination, request, preparation, steps, recovery, publication */
  origin: Origin;
  footprint: Footprint;                                   // declared at admission (§2.4)
  consent: null | { run: RunRef; decision: AllowDecision } | { by: "press" };
  state: "waiting" | "running" | "succeeded" | "partial" | "failed" | "cancelled" | "unknown" | "incomplete";
};
```

Exact definitions. **Submitted**: immutable intent is durably recorded and id dedup applies. **Waiting**: consent is required and its decision is pending. **Authorized**: the command has recorded its admission evidence and may prepare and execute subject to cancellation and domain checks. **Prepared**: the handler has sealed the values and plan it will execute. A recorded step is not evidence of dispatch: the current journal records a step before export and before its effect callback. **Dispatched** requires executor evidence; failure before dispatch and unknown outcome must remain distinct. The kit derives waiting, preparing, running and outcome projections from these facts.

### 2.4 Effects: a static kind, a declared footprint, a fenced step

```ts
interface ActionDefinition {
  says: string;
  needs: ActionNeed;
  dirties: readonly ActionReadingKey[];     // cache invalidation only; never read for policy
  effect: "query" | "command";              // explicit; pe_read runs queries, pe_do runs both
  input: z.ZodType;                          // DELETED: actor; DELETED (worktree): mutates
}

type Effect =
  | { kind: "document"; ref: DocumentRef }   // user resource; exact lifetime
  | { kind: "session"; session: string }     // user's Revit lifecycle
  | { kind: "member"; pod: string; path: string }   // user-authored pod source or settings
  | { kind: "file"; path: string }           // an explicit user resource outside a pod
  | { kind: "receipt"; pod: string; path: string }  // host-owned run output; never held
  | { kind: "publication"; page: string };
type Footprint = readonly Effect[];
```

Each handler describes its effect footprint from the frozen admission. Resolving a script or lifecycle census may require bounded asynchronous reads; it is not assumed to be a cheap pure function. Preparation must not silently expand the submitted destinations or input. Mutation steps carry resource identities and are checked against the footprint. Read steps use registered query operations and do not count as writes to their source document. A query may create host-owned evidence, but may not alter user documents, members, files or published content. Unknown operation keys are refused; known operations with uncertain effects cannot execute as queries.

Policy is one pure function:

```ts
const holds = (e: Effect) => e.kind !== "receipt";
const consentNeeded = (fp: Footprint, o: Origin, pea: (ref: DocumentRef) => boolean) =>
  o.run !== null && fp.some((e) => holds(e) && !(e.kind === "document" && pea(e.ref)));
```

Only documents certified as Pea-owned acquisitions skip the hold; merely opening a user's original does not establish that ownership. The provisionally accepted policy covers external mutations, including members, files and publication. Work edits and host-owned receipts are internal state and do not hold. R1 records the required revisit of this policy.

**Prepare, plan, execute, and the ceiling.** Preparation runs after consent against the frozen intent; it reads Work, plans, marks and the journal and writes only owned evidence. Preview operations may use native rollback. The relevant C# operation metadata and implementation must establish their effect classification; this workshop has not verified a universal catalog rollback flag. A script's `permissionMode` is a requested mode, not proof that all reachable documents are isolated. Native/script behavior requires native proof. Script and lifecycle footprints must account for reachable sibling documents and process incarnation. A TypeScript destination check does not sandbox Revit. A generic fallback of one target document is insufficient for arbitrary scripts or multi-resource operations.

### 2.5 Work: one shared change with a base, author-neutral

```ts
/* agent-contracts/src/draft.ts replaces trichotomy.ts */
type Author = "human" | "pea" | "unknown";
type Change = { value: Rung; by: Author; at: string; base: number; note?: string | null };
type Cell = {
  edit: Change | null;          // what apply sends; either author sets, clears or replaces it
  suggestion: Change | null;    // optional review content either author may leave; never a gate
};
```

Transitions, all through `route:<key>.edit` with `expectedRevision` (the existing fence, `route-doc.ts:44`):

| Transition | Who | Rule |
|---|---|---|
| `set(cell, value, base)` | either | replaces `edit` whatever its author; requires `base === envelope.revision`, plus schema and domain validation |
| `clear(cell, base)` | either | same fence |
| `suggest(cell, value)` / `unsuggest` | either | writes `suggestion`; never touches `edit` |
| `take(cell)` | either | `set` from `suggestion`, clears it |
| `retire(cells)` | host step only | clears `edit` where it still equals what a proven apply consumed (`family-actions.ts:1066`, unchanged) |

The user's scenario, Width typed 200 then "change that to 250 and apply": Pea reads revision r13, sends `set(width, 250, base: 13, by: "pea")`, apply plans against r14. No accept click. Conflict derivation needs no second slot: a stale `base` is the conflict, for either author. `suggestion` exists because a reviewer may want to leave a value without replacing one, but it is content, not a rung; nothing waits on it.

Forgery boundary by schema, not by actor: edit and suggestion values are client-authored; attribution and timestamps are stamped by the host from the caller. `retire` is a journal step. Observation, readback and consent are receipt or Reading fields that no route patch schema contains. The example's `by` is persisted output, not trusted request input. `agentWriteMask`, `trichotomyAgentMask`, `persistedProposal`'s by-check, `cellTransitions`'s actor column and the kit's `sameValue` guess are deleted.

### 2.6 What the kit owns

The kit renders `Cell` and `CommandState`, and binds buttons to route verbs. A press is consent for the human origin because the host mints that origin from the cookie; the kit computes no authorization. The composer countdown and the chat card read the thread log's `permission_request` with `deadline` (harvested from the worktree). Draft stays writable while a command waits; per-command cancel is `action.cancel`; the card's Cancel is Stop.

### 2.7 Completion and proposed-work notifications

User direction, 2026-10-26: notify when Pea finishes its turn and has proposed work. The recommended projection is one end-of-turn notice that states what completed and identifies any proposed Work ready to review, with a link to that exact Work. A turn with commands still running must say that work continues, not claim that its writes finished. Proposed Work is review content and the notification does not add a staging or approval gate.

Reuse the existing host notice stream (`host/src/notices.ts`, turn completion notice) and tray/browser delivery (`web/src/machine/os-notices.tsx`). The latter already consumes notices with a persisted cursor and suppresses duplicate browser delivery while the tray follows. Derive the new content from durable turn, command and Work references rather than asking Pea to send a separate notification tool call. Source presence is not delivery proof. Verify a completed turn with proposed Work, a completed turn with writes still running, reconnect and two-window delivery. The details of foreground quieting and future child-notification aggregation remain implementation choices, not additional product gates.

## 3. One Family apply, human and Pea, same command

Today `entity-route.ts:352-389` chooses plan, optional confirm, then apply, and Pea would repeat the two calls by hand. The replacement is one composed command on the existing journal, no new framework:

```ts
/* agent-contracts: family.apply input */
{ target: DocumentRef;
  rows: { source: Source; include: "all" | string[] }                   // direct: plan inside prepare
       | { plan: string; expectedPlanHashes: Record<string, string> } } // after a preview the user edited
```

```ts
/* host/src/family-actions.ts — family.apply */
footprintOf: (a) => [{ kind: "document", ref: a.destination.ref }, { kind: "receipt", pod, path }],
prepare: async () => {
  const plan = "plan" in rows ? journal.row(rows.plan)                       // sealed preview, hashes checked
                              : await planPrepare(frozenSource, frozenWork); // captured on submit, never latest Work
  const included = "plan" in rows ? rows.expectedPlanHashes : includedOf(plan, rows.include);
  assertPlanMatches(plan, included);          // existing :584
  assertConsumedUnchanged(plan, work);        // existing :551-579
  assertFresh(marks, target, plan.takenAt);   // existing :581
  return { ...sealedOf(plan), included, retire: consumedOf(plan), footprint: [...] };
},
execute: unchanged                             // native, retire, readback :940-1017
```

Consumers:

```ts
// browser, one press, no preview
await workflow("family.apply", { rows: { source, include: "all" } }, ctx);
// browser, after the confirm sheet
await workflow("family.apply", { rows: { plan: sheet.id, expectedPlanHashes } }, ctx);
// Pea
pe_do family.apply { target, rows: { source, include: ["Door-A", "Door-B"] } }
// preview stays an explicit read on the same facts
pe_read family.plan { target, source }   /   plan.read(ctx, source)
```

`family.plan` remains the preview query; `entityRoute.run` keeps only "confirm → sheet" versus "press → apply". `byPlan` survives as the sheet-to-input fold. Plan hashes and source bytes stay internal to the host. Parameter Links and ducts take the same shape: `apply` accepts rows or a sealed preview id.

**Discovery.** `pe_find` lists every row with `effect`; `pe_read` refuses `command`; `pe_do` runs both. The "human-only rows are not offered" sentence and the Full/Guarded prose in `capability-tools.ts` are deleted. Capabilities derive from the one `ActionDefinition` record, as today.

## 4. Transport and the causal run context

Doors unchanged: `POST /actions` submit, `GET /actions?id` read, SSE stream, `action.cancel`, `POST /pe/threads/:id/permission` decide. `POST /actions` may return a `waiting` receipt; the MCP tool awaits settlement by polling, as the worktree does.

**Order at submit.** Authenticate the caller first. Check a known command id against its immutable normalized payload and the authenticated caller's right to inspect it. Human and device callers need their own identity rule; thread equality alone is not a universal ownership check. Return an authorized existing receipt before requiring a live run for a new admission. For a new command, bind the causal run and freeze destination, source bytes or content hash, selected edit values and their revisions. Resolve its footprint, durably create the row, then wait on consent if needed. Prepare and execute follow the decision. Work capture must succeed against the revision submitted; it must not absorb newer Work during the wait. Retries observe the original command, including cancelled and uncertain outcomes.

**Run token.** Objection 3 stands against round 2: `t.running` read at submit is not causal. The harness child, its shell, and a backgrounded `pea` process all carry the same spawn token, so a stale shell write during the next turn would be stamped with that turn. Decision:

- At `run()` (`threads.ts:1429`) the host mints a run token, `mintContext({kind:"run", thread, turn})`, and retires it at `:1519`. `callerOf` resolves a run token to `{caller: pea, run}`.
- The MCP server obtains it **at tool entry** through the existing `beforeTool` hook (`server.ts:54`): `GET /pe/threads/:id/run` with the spawn token returns the current run token or 404. The value captured at entry rides that tool call's host requests as a header. A tool that outlives its turn still carries its own turn's token and refuses `run.closed`; it is never stamped with the next turn.
- The shell and the `pea` CLI inside Pea's tree carry the spawn token only. Their `command` submissions resolve `run: null` and refuse `run.none` with the hint "run writes through pe_do". Queries pass. This is a behaviour change for Pea-driven CLI writes and is the price of attribution; stated as an assumption, not a question.
- Entry-time lookup is a candidate adapter, not established causal carriage. An old invocation delivered to the MCP server only after the next turn starts could still acquire the new token. The adapter must correlate the invocation to its original turn or prove that delayed delivery cannot cross the turn boundary. A per-call immutable invocation context must carry the result; the existing `beforeTool` callback alone does not establish this.

**What this does not ground.** Run carriage through both persistent harness adapters is unproven. S1 exercises delayed delivery, cancellation, a background shell and a new turn with a controlled adapter test; it needs no Revit. Freeze the requirement for an authenticated immutable `RunRef`, not the proposed current-run endpoint. Prefer carrying that identity through supported MCP and CLI invocation paths. Refusing an unscoped write is the fallback; permanently removing Pea's CLI write path is not an accepted product decision. S1 chooses the smallest reliable adapter before implementation proceeds.

**Decision transport.** One `permission_request` per turn at most; `POST /pe/threads/:id/permission` is idempotent on `requestId`: the first answer wins and later answers return the recorded decision, so two windows cannot disagree. Restart: the thread log replays the ask; an unanswered ask older than its deadline resolves `by: "deadline"` on replay only if the run is still `open`, which it never is after a restart, so it resolves `stopped` and waiting rows settle `cancelled(consent.stopped)`.

## 5. Timeline: two documents, one approval, an edit during the countdown

1. Turn 7 starts: run token R7 minted. Pea `pe_do ducts.apply-losses` on Project A: MCP entry fetches R7; submit → dedup miss → origin `{pea, run: 7}` → footprint `[document(A)]` → `consentNeeded` → row A `waiting`; ask opened, card "Write to Project A, and the rest of this turn's writes. 60 s". Work on both routes stays writable.
2. Pea `pe_do family.apply` on Project B with `rows: {source, include: "all"}`: row B `waiting`, attached to the same ask; the card now lists B (assumption: the card lists every attached destination; a later write to an unlisted document leaves a chip in chat).
3. Human edits a Families cell → Work r14 via `set(…, base: 13, by: "human")`. No lock, no refusal.
4. Human presses Write now at 41 s: decision `allowed by human`; rows A and B stamp `consent {run: 7, by: "human"}` and go `running` in journal order.
5. Row B prepares **now**, after the hold, using its submitted r13 values, never the latest r14 values as new intent. A changed consumed edit invalidates that command; an unrelated edit may proceed where the domain supports per-change validation. Plans validate current model facts against the frozen requested changes. Just before mutation, the handler/executor must still enforce the captured Work and native basis. Reuse existing checks where their placement suffices, and move or repeat them at the effect boundary where a queue introduces a gap. Conditional retirement after success preserves later edits but cannot prevent a stale native write. An invalidated command leaves a receipt; Pea may read and submit a new explicit command under the same allowed turn, without another countdown. Native partial, failed and uncertain outcomes remain distinct. No Work lock is held through the countdown.
6. A third Pea write in turn 7 admits at once.
7. Turn ends normally: `closed/completed`, decision retained; already-authorized bounded commands finish. Waiting commands without approval are cancelled. A new command with R7 refuses `run.closed`; authorized retries may read its old receipts. Turn 8 starts `idle` with its own identity.
8. Explicit Stop during a turn: `closed/stopped`; waiting commands and remaining unstarted mutations are cancelled at execution checkpoints. A dispatched native effect reports its real outcome. The host must connect this transition to journal cancellation; stamping a prior consent decision alone is insufficient. No cancelled intent auto-retries.
9. Host restart mid-hold: the ask replays `stopped` (§4); the receipts show `cancelled`; a reconnecting MCP client that retries the same id receives that row and the model re-plans.

## 6. Ownership, deletions and cutover

**Pea policy deleted.** Pea's dependence on `admitTarget`, `admissionOn`, `Basis`, target admission metadata and target-revision revocation; product-action `actor` eligibility, worktree `mutates` and pre-admit `awaitHold`; Work's `RouteStateCommandSpec.actor`, `agentWriteMask`, trichotomy masks and transitions; Pea's `routeWorkKey` thread check and MCP mirror; actor chips, inferred `stagedBy`, thread-move Work clearing and automatic tool collapse. Remove shared helpers and refusal codes only after their remaining transport/security consumers have moved. Context target revisions may still serve optimistic concurrency; they no longer authorize Pea writes.

**Kept as a separate trust adapter, explicitly.** Page doors (`pageBinding.boundBy`), the external-mcp arm of `admitCrossing` with its `live()`/`onRevoke` target revocation, caller minting and transport binding, SDK ADR 0012 custody. External devices have no harness run; they keep thread-target admission until a ruling replaces it. This proposal widens no external right and names that adapter in the ADR so it is not mistaken for a leftover.

**Kept because it checks truth.** Journal dedup, overlap block, preparation export, step persistence, resume, retire; `expectedRevision`; `RouteWriteAdmission`; plan hashes; `assertFresh`; exact lifetimes; K9 sibling census (now the script's `footprintOf`).

**Cutover, no second writable model, no bridge.**
1. Do not land `t3-write-countdown` as is. Harvest `deadline` on `permission_request`, `by:"deadline"`, `settleAsks`, composer countdown and its tests.
2. `agent-contracts`: `Origin`, `Effect`/`Footprint`, `effect` on definitions, `Cell`/`Change`; delete the nouns above; compile breaks are the census.
3. `host`: `waiting` state and step fence in the journal; run token and `GET /pe/threads/:id/run`; `RunConsent` in the harness; every handler exports `footprintOf`; `family.apply` composed input.
4. Replace persisted Work in one cutover with an explicit converter and preserved source bytes. Known staged values become edits with unknown historical authorship; proposals may become suggestions where the old schema establishes their meaning. Preserve evidence and revisions without inventing a base of zero. Detect conflicts and unreadable input explicitly. No on-read compatibility interpreter remains in production and no old shape is written after cutover.
5. `mcps`: `beforeTool` run fetch; `pe_do` awaits `waiting`; `pe_read` keys off `effect`.
6. `web`/`kit`: §3 consumer; `Cell` binding; card and countdown from the thread log.
7. One ADR, number assigned at landing: "Run consent, footprints and shared Drafts replace grants, holds, human-only actions and the proposal rung"; supersedes the grant and hold rulings in 0016, 0017, 0021 and the uncommitted 0022 draft; rewrite the AGENTS.md Posture line "Agents propose; users retain approval".

## 7. Where this stands with Astra

**Agreed.** No mandate, no widening; one engine (`ActionJournal`); Family handlers keep plan sealing, hashes, native, readback and retire; harness owns the run decision, journal owns commands, linked by `consent.run`; kit renders and never authorizes; draft stays writable during a hold; per-command cancel is distinct from Stop. Objections 1, 2, 4, 5, 6 and 7 are accepted and answered above: one author-neutral change with a base (§2.5); explicit `effect` plus declared footprint, `dirties` demoted to cache (§2.4); hold before prepare so prepare is the post-hold validation (§5); one composed apply (§3); principal retained and external adapter named (§6); report truth corrected.

**Ordering correction.** Fable correctly moved the hold before preparation. Astra's final check narrows that conclusion: preparation must consume frozen input, and any later queue gap still needs validation before mutation. No new public lifecycle phase is required, but ordering alone does not prove freshness. Effect classification remains explicit; no universal catalog rollback flag is assumed.

**Design convergence.** Both recommend the core owners, actor-neutral edits, once-per-turn consent and shared Apply. Optional suggestions are review content, not another permission rung. Adapter carriage, footprint completeness and dispatch validation remain engineering questions requiring spikes; they are not claimed settled by agreement.

**Spikes before any claim of real.** S1: causal identity through both persistent harness adapters, without Revit. S2: journal waiting/dedup/decision recovery, same-resource concurrent submissions, cancellation races and frozen Work under a countdown, deterministic lane. S3: controlled fresh Revit proof of exact-target mutations, partial and uncertain outcomes, native preview isolation, sibling script effects and Stop after dispatch. Browser checks cover one card in two windows, countdown visibility and thread navigation preserving the tool. No single lane proves this entire workflow.

**User rulings and deferred decisions.**
- **R1 Non-Revit external writes: provisionally accepted, revisit owed.** The user agreed to proceed with one turn approval covering these writes, while questioning its practical fit. Existing editors for JSON-backed resources are very early, may never cover every resource type, and have incomplete routing and resource management. Most users cannot review raw JSON. Therefore the countdown is an opportunity to intervene, not evidence of informed content review or a complete editor. Do not make a dedicated editor a prerequisite for Pea's work. Revisit the policy against understandable change summaries and the actual resource lifecycle; the owning Owed item is in the [agent ledger](LEDGER.md#owed). Draft edits and internal receipts stay immediate.
- **R2 Child runs: settled direction, 2026-10-26.** The user agreed that descendants delegated within the same task share the root turn's approval and Stop. Use host-issued causal links. Independently started or scheduled work has its own approval. The user wants an eventual escape from shared approval but explicitly deferred it; the escape's behavior is not yet designed. Fable's separate-countdown-per-child recommendation is rejected for the default. This direction is not implemented.

Assumptions stated, not asked: the card lists known destinations without asking again for later ones; receipts expose later destinations; thread targets remain input defaults; switching threads preserves the selected tool. Unscoped Pea writes refuse, but causal CLI support remains part of S1 rather than being silently removed.

## 8. Rejected alternatives worth keeping

- **Mandate record** `{birth, scope, until}` beside the turn: three owners for one fact; replaced by `RunConsent` on the turn.
- **Second command kernel** with its own submit/observe/cancel: a description of `ActionJournal.admit`; rejected as a duplicate engine.
- **Two-slot Cell with an actor rule** (`edit` replaceable by Pea only when Pea wrote it): recreated the permission ladder; replaced by base-revision concurrency for both authors.
- **`reads = dirties.length === 0`**: cache invalidation is not effect policy; replaced by explicit `effect`.
- **Hold after prepare** so the card can name the prepared footprint: reopened a freshness gap; replaced by `footprintOf` at submit and prepare after the decision.
- **`t.running` at submit** as run identity: not causal for persistent child processes; replaced by a run token captured at MCP tool entry, with S1 owed.
- **Pea-specific CLI run inheritance via env**: a persistent process cannot receive a per-turn env; rejected.

Stamp: UNPROVEN[source reasoning only; no build, test, Revit or browser; line references are main `0b40c293` and the `t3-write-countdown` diff on 2026-10-26].
