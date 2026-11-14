# pod-pages map

Goal (root brief, 2026-11-14): "Pea can now make featureful tools for them, and they can share them. A tool is a Pod of plain Pages and C# scripts, dropped in the shared drive, used with no restart, and usable by Pea as well as by a person." What a Page still cannot do at the end decides whether the frozen Pod-route tier is deleted.

Run directory: `C:\Users\kaitp\source\repos\Pe.Tools\.artifacts\runs\pod-pages-20261114\`. Plan check: `plancheck\A.md` (Page runtime), `B.md` (Pod packaging), `C.md` (Pea), and the purger's `purger\BASELINE.md`, all read at main 9c526aa2.

## Nouns and invariants

- **Pod**: one folder with `pod.json`, Pages, C# scripts and the files they use. **Page**: plain HTML at `pages/<page>/index.html` that loads `/pages/pe.js`. **Scratch Page**: a folder under `<home>/Pages/<slug>`, the draft home Pea's publish door writes; it has no scripts Pea can name, no off switch and no archive. **Entrypoint**: a script a Pod declares in `pod.json`; it is the only script a Page and Pea both run by key.
- **Tour**: a Pod bound to one model, whose ElementIds are its content (pdrop on Chadds). **Tool**: a Pod that works on any model (document-profiler; the view-template manager Pea writes in slice 8).
- One script door. A Pod's scripts run by key, `script:@<pod-id>/<path>`, with one input and one answer shape, from a Page, from Pea and from the palette alike (contract C1).
- One state model. A Page's event log is the authority; every other view of it is derived and names the seq it reflects (contract C2).
- A Page calls op and script keys, and the live host answers availability. A Page never names its own document.
- Pod routes are frozen: none built, none deleted until the decision at the end. Pea builds no Pod route on an installed machine.
- Page state lives under the machine state root, keyed by Page slug, never inside the Pod (`ts/apps/host/src/pages-route.ts:437`). A Pod that moves homes keeps its slug; a scratch Page promoted into a Pod starts a new log.
- The owner's `Documents\Pe.Tools` tree is never edited in place by the run. Drives copy into an isolated product home.

## Contracts two writers share

These are written once here. A writer codes against this text; a change to it is made here by the implementor and sent to every writer it names.

### C1 script door (owner: W1; readers: W3, W4, W5, W6, W9)

- `pod.json` entrypoint: `{ "sourcePath": "<path>", "name"?, "description"?, "mode"?: "ReadOnly" | "WriteTransaction" | "NoTransaction" }`. `sourcePath` is any `.cs` or `.csx` member of the Pod (no longer only `src/*.cs`), including a file under `pages/<page>/`. A statement-body file (no type declaration) is accepted and wrapped as inline scripts are today (`RevitScriptExecutionService.cs:574-593`). Other `.cs` files of the Pod compile beside it, so a shared helper is a static class in its own file.
- `mode`, when declared, is the default for every door. An entrypoint declared `ReadOnly` is a read: Pea runs it with `pe_read`, and a caller asking a write mode for it is refused. An undeclared mode keeps today's behavior (the caller chooses, write by default).
- `ExecuteRevitScriptRequest` gains `Input`: an optional JSON object, at most 256 KiB, passed through untouched by every door. `PeScriptContainer` exposes it as `protected JsonElement Input` plus `protected T Arg<T>(string name)` and `protected T Arg<T>(string name, T fallback)`, which throw in plain words naming the missing or ill-typed argument.
- The host stamps the folder of the calling Pod on the request (as it stamps `Caller`). `PeScriptContainer` gains `protected string PodFile(string relativePath)`: the absolute path of a member of the running Pod. It refuses a path that escapes the Pod and throws "this script runs outside a Pod" for an inline run. It reads the live file.
- Page door: `pe.script(keyOrPath, { input, mode, timeoutSeconds })`. A relative `.cs`/`.csx` path on a Pod Page resolves to that Pod's entrypoint key relative to the Pod root; a path the Pod does not declare is refused with "declare <path> in pod.json entrypoints". A source string (contains a newline) still runs inline, for scratch Pages and probes. `pe.do("script:@…", { input, mode, timeoutSeconds })` is the same call. Both answer the script's `Result(...)` value and throw with the compiler's or runtime's own words; the full run record is on the error and on `pe.lastRun`.
- Pea: `pe_do script:@<id>/<path> { input, permissionMode, timeoutSeconds }` and, for a `ReadOnly` entrypoint, `pe_read script:@<id>/<path> { input }`. The catalog row carries the declared `mode`.

### C2 Page state (owner: W2; readers: W3, W4, W5, W6)

- `pe.state({ reduce, base, render, describe, local = [], agent = {} })` replaces `pe.kernel` + `pe.state(k)` + `pe.describe`. It answers the kernel `k` (`k.state`, `k.fire(ev)`) once the saved log is replayed. `reduce(state, event, meta)` gets `meta = { origin: "page" | "agent" | "person", seq, at }` for every replayed and live event.
- `agent` declares the events an agent may append: `{ <type>: "<one line: what it means and its fields>" }`. The host keeps the declaration beside the Page's text. An agent append whose `type` the Page does not declare is refused 422 with the declared list in the words.
- The browser-written `snapshot.json` and its PUT door are deleted. Export embeds the event log and replays it offline. The `describe` text is the one derived view the host keeps, stamped with the seq it reflects.
- Pea: `pe_read page:@…` answers `{ seq, text, textSeq, agent, events, target }`, where `events` is the tail after an optional `after` cursor (default: the last 50). `pe_do page:@… { event }` appends with origin `agent`.

### C3 model identity (owner: W3; readers: W4, W6)

- `pod.json` gains `"for": { "title": "<document title>", "probes": [ { "elementId": <int>, "uniqueId": "<string>" } ] }`. A Pod without `for` is a tool and runs on any model.
- `page.target` on a Page of a Pod with `for` resolves the binding, then checks every probe with one read. A mismatch answers resolution `{ kind: "refused", reason: "wrong-model" }` with the words "this Pod is for <title>; the bound document is <title>", and `pe.target()` throws it as a `PeTargetRefusal` before the Page draws. A script run of that Pod by any door is refused with the same words.

## Ordered deletable slices

| # | Slice | Falsifier | Paths the falsifier observes | Priority |
|---|---|---|---|---|
| 0 | Baseline: pdrop-tour as it is, on the landed build, bound to Chadds | driven walk of the Page, one line per check and per heal: works, refused (host's words), or wrong | `ts/apps/host/src/pages/pe.js`, `ts/apps/host/src/pages-route.ts`, `ts/apps/web/src/revit/revit.js`, `dotnet/Pe.Revit.Scripting/` | first; no writer |
| 1 | pdrop is one Pod: Page, scripts and the family file travel together, on C1 and C2 | the Pod copied to an empty home passes the slice 0 walk; no `.cs`/`.csx` holds an absolute path; every check is an entrypoint | the Pod folder (`<run dir>\pods\pdrop\`); `ts/apps/host/src/packages.ts`; C1 paths | high |
| 2 | Dynamic: a Pod dropped or edited in the firm home is seen with no restart, and its first request answers | one drop and one edit of a Page-and-script Pod on the real shared drive, moved not copied; the first open after the drop succeeds | `ts/apps/host/src/package-lifecycle.ts`, `ts/apps/host/src/pages-route.ts` | high |
| 3 | Pea uses it: no browser, Pea targets Chadds, runs the Pod's checks by key, gets the same rows the Page recorded, and a verdict Pea appends appears on the open Page marked as Pea's | `pea --prompt` black-box probe; the rows compared with the Page's reading events | `ts/packages/mcps/src/pea/`, `ts/apps/host/src/pages-route.ts`, `ts/apps/host/src/pages/pe.js`, the Pod folder | high, owner's emphasis |
| 4 | It names the model it is for (C3) and refuses in plain words on another | the pdrop Page bound to a different model: one refusal, nothing drawn; Pea's run refused with the same words | the Pod's `pod.json` and Page; `ts/apps/host/src/pages-route.ts`; `ts/apps/host/src/packages.ts`; `pe.js` | medium |
| 5 | It survives a release: the same Pod, unedited, passes the slice 0 walk on the release build | the walk repeated on the installed build | slice 0 paths plus the installer | medium; blocked on D1 |
| 6 | A heal shows what it changed: ids on every script result, `pe.diff` on them, one undo item per run | a driven heal on a Chadds copy: the change ids, the diff, one Ctrl+Z restores | `dotnet/Pe.Revit/Operations/OperationScopes.cs`, `dotnet/Pe.Revit.Scripting/Execution/RevitScriptExecutionService.cs`, `pe.js` | low; Owed if skipped |
| 7 | The Page marks the failing elements on a picture: the capture answers pixel boxes per element | a driven look at one point with two named elements boxed and labelled | `dotnet/Pe.Revit.DocumentData/AgentContext/RevitViewImageExporter.cs`, `ts/apps/host/src/native-output.ts`, `pe.js` | low; Owed if skipped |
| 8 | Pea writes a tool: from one prompt on an installed build, a view-template manager Pod with a Page and scripts that compares two templates and copies filter overrides, visibility, enabled flags and order; it works on two models | the API spike script first (row 8a); then `pea --prompt` on the installed lane; a person opens the Page on a second model and runs one copy on a disposable copy | `ts/packages/mcps/src/pea/`, `pages-route.ts`, C1 paths | last; the product claim's acceptance |
| 9 | Pea learns Pods from one place: build-pod is the one home of what a Pod is, a Pod's Page is a file, the examples teach C1 and C2, and document-profiler is the tool-kind example with a Page | a cold `pea --prompt` asked to add a Page to a Pod uses the file path and the key door, with no contradiction in its own words | `ts/packages/mcps/src/pea/skills.ts`, `instructions.ts`, `examples/pods/` | high; slice 8 depends on it |

Row 8a (driver): one script on a Chadds copy settles the API before the slice 8 prompt is written: `View.SetIsFilterEnabled` on a view template's filter, and remove-and-re-add to reorder a template's filters, each read back. The Revit 2026 API docs give `SetIsFilterEnabled` a setter with no template restriction and give filter order no setter (plancheck C, section 2).

## Writers

| Branch | Slice | Tier | Model | File set (disjoint except where named) |
|---|---|---|---|---|
| `pp/script-door` (W1) | C1 | heady-writer | claude-fable-5-2 medium | `dotnet/Pe.Shared.HostContracts/Scripting/ScriptContracts.cs`, `dotnet/Pe.Revit.Scripting/Context/*`, `dotnet/Pe.Revit.Scripting/Execution/RevitScriptExecutionService.cs`, the Pod bundle compile path, `dotnet/Pe.Shared.Scripting/Pods/PodManifest.cs` (entrypoints), regenerated host contracts, `ts/apps/host/src/packages.ts` (entrypoint parse, `kindOfMember`), `ts/apps/host/src/pages-route.ts` (`operationOf` only), `ts/apps/host/src/call-route.ts`, `ts/packages/mcps/src/pea/capability-tools.ts` and `capability-projections.ts` (script rows), `pe.js` (`pe.script`, `pe.do` script branch), their tests |
| `pp/page-state` (W2) | C2 | slog-writer | gpt-6.1-sol high | `pe.js` (`pe.kernel`, `pe.state`, `pe.describe`, the stream), `pages-route.ts` (state, events, snapshot, text, export), `ts/apps/host/src/page-export.ts`, `ts/apps/host/src/page-publication.ts`, `ts/apps/host/src/page-libraries.ts`, `ts/packages/host-contracts/src/pe-api.ts` (page routes), `capability-tools.ts` (page branch only), purger findings A3, A4, A6, A9, A10, their tests |
| `pp/for-model` (W3) | C3, slice 4 host side | slog-writer | gpt-6.1-sol high | `packages.ts` (top-level `for` only), `PodManifest.cs` (`for` only), `pages-route.ts` (`target()` only), `pe.js` (`pe.target`), `ts/packages/agent-contracts` page target reading, script-run refusal at the Pod door, their tests |
| `pp/pdrop-pod` (W4) | 1, 3 and 4 content | heady-writer | claude-fable-5-2 medium | `<run dir>\pods\pdrop\` only (untracked; report a file hash list in place of a commit) |
| `pp/profiler-page` (W5) | 9 (tool example) | heady-writer | claude-fable-5-2 low | `examples/pods/document-profiler/` |
| `pp/pea-knowledge` (W6) | 9 | heady-writer | claude-fable-5-2 medium | `ts/packages/mcps/src/pea/skills.ts`, `instructions.ts`, their tests, `examples/pods/snowdon-ducts/`, `examples/pods/snowdon-circuits/AGENTS.md`, `dotnet/Pe.Revit.Scripting/Bootstrap/ScriptFileTemplates.cs`, `ts/apps/host/src/pod-transfer.ts` (promote moves, not copies) |
| `pp/picture-marks` (W7) | 7 | slog-writer | gpt-6.1-sol high | `RevitViewImageExporter.cs`, `dotnet/Pe.Shared.RevitData/AgentContextContracts.cs`, `native-output.ts`, `pe.js` (`pe.picture`), a proof test beside `ViewImageRegistrationProofTests` |
| `pp/late-first` (W8) | 2 | slog-writer | gpt-6.1-sol medium | `package-lifecycle.ts` (`requirePackageEnabled`), the Pod Page lookup in `pages-route.ts` (`dirOf` only), `ts/apps/host/tests/pod-late-arrival.test.ts` |
| `pp/changes` (W9) | 6 | heady-writer | claude-fable-5-2 medium | `OperationScopes.cs`, `RevitScriptExecutionService.cs`, `ScriptContracts.cs` (`changes`), `pe.js` (`pe.diff`); starts after W1 merges, because both own `RevitScriptExecutionService.cs` and `ScriptContracts.cs` |

Shared files: `pe.js` (W1, W2, W3, W7, W9 on separate functions), `pages-route.ts` (W1, W2, W3, W8 on separate functions), `packages.ts` and `PodManifest.cs` (W1 entrypoints, W3 `for`), `capability-tools.ts` (W1 script rows, W2 page branch). The implementor merges them; conflicts have run near one percent of merged lines.

## Timing plan

- Wave 1, at once: W1, W2, W3, W4, W5, W6, W7, W8. W4, W5 and W6 code against C1 to C3 and merge after the contracts they read.
- Critical path: W1, then W4 proven on it, then row 3. W9 starts when W1 merges.
- Driver rows: 0 now; 8a now on the same session; 2 after W8; 1, 3 and 4 after W1, W2, W3 and W4; 5 and 8 after D1 and the installer; 6 after W9; 7 after W7.
- Estimates, from the last run's ratio of actual to estimate near 0.25 (kernel2) and about 400 added lines per heady writer-hour (homes):
  - Estimate: pp/script-door 3h
  - Estimate: pp/page-state 2h
  - Estimate: pp/for-model 1.25h
  - Estimate: pp/pdrop-pod 2.5h
  - Estimate: pp/profiler-page 1.5h
  - Estimate: pp/pea-knowledge 1.5h
  - Estimate: pp/picture-marks 1.75h
  - Estimate: pp/late-first 0.75h
  - Estimate: pp/changes 3.5h

## Plan check corrections

- The map's `.state/events.jsonl` inside a Page folder is dead: state moved to the machine state root on 2026-11-11 with no migration (plancheck A lead 1, B finding 4). pdrop opens unbound and empty, and its old log is not carried.
- A human pin gives reads and ReadOnly scripts only. Every write of the pdrop Page needs a thread binding with the document added, or a Pea-acquired copy (plancheck A lead 2).
- A script had no argument channel and no way to name its own Pod's files; C1 adds both (plancheck A lead 4, B section 2).
- Slice 3 is half built: Pea already reads, appends to and binds a Page (`ts/packages/mcps/src/pea/capability-tools.ts:771-807`). What was missing is a key for the Page's checks, a declared event vocabulary, origin on the Page, and freshness (plancheck C section 1).
- Slice 2's code landed in kernel2; what is left is the first request after a drop answering 404 until a reload (plancheck B slice 2 item 1), and the real drive drop.
- The Pod-route census is about 1,090 to 1,630 non-test and 2,370 to 2,650 test lines plus two 16 MB artifacts zipped into every build, not 810 and 1,150 (plancheck B section 4; purger headline 4).
- The suspected API gap is filter order, not the enable toggle (plancheck C section 2); row 8a settles it.
- Main cannot stage the installed payload (D1, `ts/apps/host/scripts/stage-web.mjs:47`), so slices 5 and 8 wait for the integrator's fix.

## Deletion criteria

- At the end: if no slice needed a Pod route, delete the tier (the census above), with Hydronic and the snowdon-circuits voltage-drop route, and rename the surviving `plugins.list`/`plugin.update` doors to `pod.*`. Otherwise record what a Page still cannot do.
- A slice that is skipped becomes one Owed line in `docs/features/pods/LEDGER.md`.

## Risk tier per surface

- High: the write path (slice 6) and C1's input and Pod-file path on the script door. Each gets a non-author review before it lands.
- Medium: `pe.js`, `pages-route.ts`, Pea's doors (slices 0, 3, C2, C3).
- Low: the Pod folders and Pea's skill text (slices 1, 4 content, 9).

## Out of scope

- A Pod per scratch Page, or the scratch home folded into Pods. The code shows serving and state are already one; the difference is key, off switch, admission and the publish door (plancheck B section 3). Owed: the owner's verdict after slice 8 shows whether Pea wants a Pod-targeted publish door.
- A programmatic Revit undo door, and a dry run for NoTransaction scripts (plancheck A slice 6).
- Pod routes, trust and B52 to B60, frozen with the tier.

## Decision log

- 2026-11-13, owner: "new crusade is fine I guess." The Pages-tier work is its own crusade, not a slice on kernel2's map.
- 2026-11-13, owner: "yes to all 7, and esepcially pea being able to use and interface with it (which also includes binding." Slice 6: "low-ish prio. its the principles answer but a rabbit hole." Slice 7: unsure, low. "i still want them all tho so anything skipped should be [owed]."
- 2026-11-13, owner: "good catch on elementids, they are necessary since its for a specific project."
- 2026-11-13, owner: "yes to freeze pod routes".
- 2026-11-13, owner: "yes to on-by-default for firm" for a Pod that appears after host start.
- 2026-11-13, owner liked trust by source over trust by bytes. With Pod routes frozen, trust guards nothing a demo Pod uses, so the ADR waits.
- 2026-11-13, owner on a tool-kind target: "thats what mep-edit-all was in my head but its certainly not a cheap test. maybe the document profiler pod? or u can just make one up... a lightweigth viewtemplate manager that lets you sync up colors, patterns, styles, and order between templates." Main agent proposed document-profiler as the cheap target and the view-template manager as slice 8, written by Pea. Owner: "yes agre."
- 2026-11-13, owner on a late Pod in the user or project home: "idk. occam for now. this needs real milage before i make a true veridct", and "we're so beta now anyways it doesnt matter, only my coworkers have it". The fix stays as written (every home alike). Owed: a verdict after real use.
- 2026-11-13, owner on the slice 8 API gap: "its the toggle for each individual filter rule of a given view template we can figure out later".
- 2026-11-14, owner: "Phase for efficiency first, doubt the plan, then implement all the way through. Operate autonomously ... continue to push pod capability and unify surfaces. a radius even a bit larger than the map or your initial touches is encouraged. Literally none of the pod-page features have been re-examined since they were first created. their capabilities were what i wanted, and some of their shapes were moulded, but do not take their current shapes as gospel". Plainly: the implementor takes the plan by default and re-shapes the Page doors.
- 2026-11-14, implementor default, re-openable: one script door (C1) with a typed `Input` on `scripting.execute`, chosen over Page-built C# source, because only a declared key is something Pea can run (plancheck C slice 8 item 2).
- 2026-11-14, implementor default, re-openable: the event log is the one Page state; `snapshot.json` is deleted (C2), per AGENTS.md "Keep one canonical persisted state/event model".
- 2026-11-14, implementor default, re-openable: model identity is declared in `pod.json` (C3), so Pea and the Page refuse alike.
- 2026-11-14, implementor default, re-openable: the pdrop Pod lives in the run directory, not in `examples/pods/`, because examples ship in every build and pdrop holds a client model's ids. It is copied into the owner's `Pods` home as a new folder at the end; `Pages\pdrop-tour` stays untouched.
- 2026-11-14, implementor default, re-openable: the scratch Page home survives this run; `pod.promote` moves a scratch Page instead of copying it.
