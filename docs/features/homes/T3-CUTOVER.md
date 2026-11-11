# T3 cutover rows

The spec for the T3 track of the [homes MAP](MAP.md) (slice 10), under [ADR 0040](../../adr/0040-t3-is-the-agent-engine-on-a-flagged-track.md). The purger holds this file. Written 2026-11-11 at main a02b8aea. Nothing here is built. Stamp for the whole file: UNPROVEN[no spike touched Revit; the track opens with one]. Sources: the owner's research list in the muse request, `muse/R6-t3-spikes-cutover.md` (the cutover map and the invest lists) and `muse/round3/t3.md` (the falsifiers), all under `.artifacts/runs/homes-crusade-20261111/`. Paths in the tables were checked to exist at a02b8aea. Fates and confidence are the T3 research thread's testimony.

The dogma, kaitpw 2026-11-11: "only if it properly deletes, replaces, and integrates everything in that research list that i included in my original message. this will be a major axis where a trailing purger must enforce the dogma".

Row rule: a row is done when its done-test is green at a named SHA and the Pe side is deleted, merged, or kept with a written reason in the Fate cell. No row may end as "both exist". The engine flag exists only during the track and is deleted at cutover. A row with no witness stays open.

## The spike

Lane: a controlled `pe-revit session` dev session on the detached Chadds clone, a source Pe.Host with the T3 sidecar from `t3/t3-spike-codex-r4` (08ee7890) rebased on main, an isolated product home, the firm OpenAI key, and a Claude key if one is available. The spike waits for the Revit lane, which the kernel crusade's end gate frees. Any single failure of F1 to F5 with no fix on Pe's side is a no-go.

| # | Falsifier |
|---|---|
| F1 | A T3 Codex thread runs a Pea Revit read on the open model. The host receipt's `RunRef` carries the T3 thread and run id, and the receipt joins to that T3 run. It fails if the receipt is unattributed or bound to another thread. |
| F2 | A Pea Revit write (a semantic action or a Work edit) from a T3 thread lands in Revit with Work authorship on the T3 run, and Revit undo reverses it. |
| F3 | The wrong-document refusal holds under T3 binding: a call aimed at a model the thread does not target is refused. |
| F4 | A guard, save over a project model: the call returns "held" before Codex's tool timeout; the notice appears in Pe's feed with a thread link; the person's own Save goes through and the receipt records it as the person's (F4a); a send that no setting pre-allows parks, and on confirm Pe runs it and posts the result into the thread (F4b). Reject leaves the model unsaved. |
| F5 | Pe Stop during a running Revit operation: the T3 run is interrupted, later Pea calls are refused `run.closed`, no Revit transaction is left open, and the host does not stall. |
| F6 | A delegated Codex child does a Revit read. Its receipt carries root = the parent run, and the parent shows the subagent row. |
| F7 | A firm-key Claude instance in the installed-shape config, with no hand-written `.mcp.json`, sees the Pea tools and completes F1. |
| F8 | Composer basics over T3: element targets and mentions arrive through `message.dispatch` context records, one image attachment reaches the agent, and the Pe-side context fields survive a reload. |
| F9 | Pe.Host restarts while a T3 thread is mid-run. On reconnect there is no orphaned open run in Pe's registry, and later receipts still attribute correctly. |
| F10 | An agent's own shell cannot read the sidecar secret. If it can, the owner rules whether cross-thread attribution forgery is acceptable. |
| F11 | Owner hand step: one personal subscription per provider (a ChatGPT login through T3, a Claude Code login in a Pe-owned home) completes a turn on the same machine as the firm-key instances. |

Measured, not falsified: the Pea tool round-trip through T3 against the current host on the same Revit call; T3 idle memory with Revit open; the per-session cost of Codex. J1 runs on both engines and must score the same within noise; it is a parity check, not a gate.

## The flip rule

Fixed before the spike runs.

- F1 to F5 pass; F7 and F11 pass or have a named fix on Pe's side; the composer port measures about a week: T3 becomes the default before a second coworker joins.
- F1 to F5 pass but the composer port runs well past a week: T3 is the last slice, after a one-coworker pilot.
- Any of F1 to F5 fails with no fix on Pe's side: T3 is out of this crusade. The generic zone stays frozen and refs stay opaque.

## Rows

Paths are under `ts/` unless they start with another root.

### Replace outright

| Row | Pe path | Fate | Done-test |
|---|---|---|---|
| Scheduled tasks | `apps/host/src/scheduled-tasks.ts` (280 lines), its state file | Deleted; T3's scheduler runs the one built-in task | the file and its state path are gone; the built-in task fires once from T3's scheduler on the dev lane; a corrupt row can no longer stop the host |
| SSH remote ingress | `apps/host/src/remote-ingress.ts`, its strict read at host start | Deleted | the file and the start read are gone; nothing reads `remote-ingress.json` |
| Doors with no client | the `receipts.read` and `log.read` doors | Deleted | the type checker finds no caller; the generated catalog no longer lists them |

### Used today, replaced

| Row | Pe path | Fate | Done-test |
|---|---|---|---|
| Harness, spawner, installer | `apps/host/src/harness/install.ts`, `user-shell.ts`, `endpoint-failure.ts`, `edge-schemas.ts`, `spawner.ts`, the ACP half of `harness/adapter.ts`, the ACP packages and their patches | Deleted; `peaMcpServer` in `adapter.ts` is kept | F1 and F7 green; the files are gone; no ACP package in the lockfile |
| Thread engine | `apps/host/src/harness/threads.ts` engine parts, `harness/thread-store.ts`, the event schemas in `packages/agent-contracts/src/harness-thread.ts`, the fold in `packages/agent-contracts/src/chat-state.ts`, `apps/web/src/workbench/provider/*` | Deleted; the view types are fed by a T3 projection; `RunRef` is kept with T3 ids | F1, F5 and F9 green; old threads are discarded with a notice; the six Pe thread fields live in one store keyed by the T3 thread id as data, never as a folder name |
| Delegated threads | the delegation paths in `harness/threads.ts` and `run-consent.ts` | Deleted; T3's `delegate_task` with lineage | F6 green; the transcript draws the subagent row with click-through |
| Attachments | the attachment paths in `harness/threads.ts` and `apps/web/src/chat/*` | Replaced by T3's | F8 green |
| `pea --prompt` | `apps/pea/src/prompt.ts` | Rewritten against T3 or deleted; `pea host`, `pea script` and `pea mcp` stay | J1 runs headless on T3 with zero presses |

### Gains, wired into Pe's UI

| Row | Pe path | Fate | Done-test |
|---|---|---|---|
| Server thread search | Pe's thread list | Wired | a search in Pe's thread list returns a T3 thread by its content |
| Generated titles | Pe's thread list | Wired | a new thread shows a generated title with no Pe title code |
| Usage, cost and rate-limit meters | a meter in Pe's chat chrome | Wired | the meter shows T3's usage for the open thread |
| Worktrees | none | Wired or declined with a written reason here | the Fate cell names which |

### Merge

| Row | Pe path | Fate | Done-test |
|---|---|---|---|
| Tailscale share | `apps/host/src/share.ts` | One owner: Pe's share or T3's `t3 pair --tailscale` | one share path remains and the other is deleted |
| Device pairing | `apps/host/src/remote-device.ts`, `device-routes.ts`, `revoke.ts` | One owner | one pairing store remains; devices pair once more, with no migration |
| Providers and endpoints | `apps/host/src/harness/providers.ts` (1200 lines), `providers.json` | Deleted; T3 provider instances, one per credential source; `apps/web/src/machine/pea.tsx` stays as the setup UI | F11 green; the firm key reaches the instance by environment at spawn and appears in no T3 file; a key change takes effect by a named recycle step; the Codex custom base URL is proven through a Pe-owned `config.toml` or written off with a reason |
| Browser automation | `packages/browser` | One owner | one browser tool surface remains for agents |

### Keep, re-keyed where needed

| Row | Pe path | Fate | Done-test |
|---|---|---|---|
| Run consent, as the three guards | `apps/host/src/run-consent.ts`, `apps/host/src/control.ts` | Kept; runs re-keyed to T3 run ids; narrowed per ADR 0038 | F4 and F5 green |
| Caller identity | `apps/host/src/control.ts`, `request-identity.ts` | Kept | F1 and F3 green |
| APS auth | `apps/host/src/aps-auth.ts` | Kept unchanged | its tests pass untouched |
| The pea MCP and capability search | `packages/mcps`, `apps/host/src/mcp-route.ts`, `apps/pea/src/cli.ts` | Kept; gains the T3 exchange and a per-call bind | F1 green on Codex and F7 green on Claude |
| Pages | the Pages routes and stores | Kept unchanged | a Page opens and binds under a T3 thread |
| Work linkage | `apps/host/src/thread-work-context.ts`, `thread-pointers.ts`, `turn-element-names.ts` | Kept; re-keyed to T3 thread ids | F2 and F8 green |
| Receipt telemetry and export | `apps/host/src/receipt-export.ts`, `thread-export.ts`, `thread-history.ts` | Kept; `thread-export.ts` is rewritten against T3 projections and joins by run reference | the grader reads one export from either engine |
| Revit notice cards | the host's notice feed | Kept; keyed by T3 thread id and run id | F4 shows the notice with a thread link |
| Self-update | `apps/host/src/update-route.ts`, `update-reader.ts` | Kept; the "Pea active" hold is re-read from T3 | an update waits while a T3 run is active and proceeds when it ends |
| Host lifecycle | Pe.Host start and stop | Kept; starts and stops the T3 sidecar; its own child teardown is bounded | a host stop leaves no T3 process; a host restart reconnects (F9) |

## Do-not-invest list

Until the flip rule fires, add no code to these. A deletion in them is free.

- `apps/host/src/harness/providers.ts`; the engine parts of `harness/threads.ts` (ACP sessions, queue, append, keepalive, modes); `harness/thread-store.ts`; the ACP half of `harness/adapter.ts`; `harness/install.ts`, `user-shell.ts`, `endpoint-failure.ts`, `edge-schemas.ts`, `spawner.ts`.
- The event schemas in `packages/agent-contracts/src/harness-thread.ts` and the fold in `chat-state.ts`.
- `apps/web/src/workbench/provider/harness-client.ts` and `thread-stream.ts`.
- `apps/pea/src/prompt.ts` as written; the ACP patches.
- Any new Pe-side store for provider keys. The firm-key resolver is needed under both engines and survives.
- A bet zone, where investment may be thrown away: `scheduled-tasks.ts`, devices, `share.ts`, `remote-ingress.ts`, `apps/web/src/chat/*`.

Safe to invest: `packages/mcps` tools, the operation catalog, scripting, `control.ts`, `request-identity.ts`, `run-consent.ts`, `mcp-route.ts`, Work, receipts, the action journal, Pods, `aps-auth.ts`.

## What the storage slices do for this track

1. Slice 5 fixes the agent's working directory once, outside any synced or shared home. T3 finds its project by that path, and a later move strands every thread.
2. The T3 home sits under the machine state root and is named in freeze item 8. Its files are `foreign`: no Pe decode, no Pe discard.
3. Slice 7 keeps thread and run refs out of paths and tags each with its engine. T3 child ids contain `:` and `%`.
4. Secrets are named by role, and the firm key is injected at spawn, never copied.
5. Provider records are entered again at cutover, never migrated.
