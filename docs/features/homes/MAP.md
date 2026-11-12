# Homes crusade map

Live frontier for [ADR 0037](../../adr/0037-three-content-homes-one-write-door.md), [ADR 0038](../../adr/0038-consent-is-a-notice-three-guards-on-project-documents.md), [ADR 0039](../../adr/0039-two-failure-policies-by-class.md) and [ADR 0040](../../adr/0040-t3-is-the-agent-engine-on-a-flagged-track.md). Written 2026-11-11 from a read-only muse at main a02b8aea. Nothing here is built. Delete this file when the last slice lands, and promote what survives into the [homes ledger](LEDGER.md). Terms are in the [glossary](GLOSSARY.md). Journeys and end-gate targets are in [JOURNEYS.md](JOURNEYS.md). The T3 rows are in [T3-CUTOVER.md](T3-CUTOVER.md). Evidence: `.artifacts/runs/homes-crusade-20261111/muse/` (seven code and disk censuses `R1` to `R7`, a cold thinker `T`, a judge `J`, `POSITION-v1` to `v4`, and five consulted threads' answers under `round3/`).

Stamp for the whole plan: UNPROVEN[nothing is built; each slice names the lane that proves it]. A claim below that cites a thread's answer is that thread's testimony until a slice re-checks it.

The goal, in the owner's words: "get us closer to pea being actually usable", with "schema and config breaks that I DO NOT want to write code to migrate". Restated: coworkers must be able to hold Pea's files without the owner writing migration code later, so the things a coworker comes to hold are frozen first.

## Nouns and invariants

- **Home**: a folder that holds authored content and proves itself with a marker file `pe-home.json` whose one field is `tier` (`user`, `project` or `firm`). The folder name is the display name. The word is reserved for content homes.
- **Layout**: every home holds `Pods/`, `Pages/`, `Catalogs/` and `Settings/<owner>.json`. The firm home adds `keys.json`. `Firm/` is renamed `Settings/` before anyone writes on G:.
- **Home list**: `[user, project home of the open model, firm]`. It takes the target document, so it is no longer a nullary path resolver.
- **Project pointer**: the model names its project home. The pointer is one owner blob in the in-model carrier. It stores a path with no drive letter, relative to the shared drive root that the firm home was found on. Pe's files sit in one child folder named `Pe.Tools` inside the folder the humans use.
- **Write door**: the one way to write into a home. It is a compare-and-swap on SHA-256, and it writes to the home the thing came from.
- **Safety net**: before an overwrite in a shared home, the prior bytes go to the writer's local content-addressed blob store, and the receipt names their hash.
- **Value tiers**, most specific first: `run`, staged `Work`, saved in model, `project`, `firm`, `default`.
- **Setting**: a fourth sheet binding kind, `setting(owner, path, schema, tiers)`.
- **Class**: two failure policies, `keep` and `discard`, carried as one argument of one decode helper.
- **Guard**: one of exactly three acts on a project document that Pea does not do without the person.
- Invariants:
  - An address has no home qualifier. A pod id is unique across homes. The same id in two homes is a conflict, and both are refused with a notice.
  - A shared home holds authored files and write-once derived files named by content hash. It never holds Work, a journal, SQLite, run output, Page state or anything machine-derived.
  - Nothing authored holds a thread or run id. An id used in a path is hashed.
  - A guard never waits inside a tool call. The call returns "held" at once.
  - Nothing stops the host from starting.
  - Unbound must work: a model with no project home, and a machine with no firm home, both run.

### Freeze list

These are settled before a coworker depends on the product, because a later change would need migration code. The inside of Work, route state and the whole T3 zone may keep changing.

1. In-model carriers: one mechanism, one envelope, the unknown-version rule.
2. Stored names: `$schema` as a library path with no origin, library keys, `@local/` and `@<pod>/` references, contribution keys. SubjectRef and thread refs join the list only if census C7 finds them in authored files.
3. The firm home's location (`04 PE Software Files\Pe.Tools` on the shared drive) and the marker.
4. The `Settings/` folder name and the home layout.
5. How a model claims its project home.
6. What may live in a content home.
7. The agent's working directory: fixed once, outside any synced or shared home. T3 keys its project on it.
8. The machine state root, its survival across an upgrade, and the T3 home's place under it.
9. The two failure policies.
10. Secret role names (`openai.api-key`, `anthropic.api-key`, `llamaparse.api-key`) and the resolver order (the person's own key, then the firm `keys.json`).
11. The written promise: what survives an update, the three guards, and the honest limit.

## Ordered deletable slices

Each slice is stated as what it deletes. "Lane" is the cheapest lane that can falsify the slice. "Gate" is the kernel crusade work the slice waits on.

| # | Slice | Settles | Deletes | Red falsifier | Gate | Lane | Wave |
|---|---|---|---|---|---|---|---|
| 0 | Standards | which files under `Pods/pe-standards` and `Pods/global` are standards; a backup; a small classed copy for the driver | no code; files the owner does not tick leave the standards set | every file in the two pods has exactly one class in the classified list; the backup's hash census equals the source; the driver copy holds no `output/` folder | none | file census, no host, no Revit | 1 |
| 1 | Names | `$schema` is a library path with no origin | the C# loopback `$schema` builders; the loopback URLs in the standards files (five ports) | guard A1: the write door given `http://127.0.0.1:5180/schemas/…`, `C:\Users\x\…`, `\\srv\share\…` and `file:///…` writes the library path; a census over `examples/pods/**` finds zero `$schema` with a scheme or host and asserts the known file count | none; rebase one line in `pods/route.ts` | TS package tests, C# compile | 1 |
| 7 | Thread refs | nothing authored holds a thread or run id; an id used in a path is hashed (no engine tag, kaitpw 2026-11-11) | raw thread or run ids used as path segments outside the do-not-invest zone | census C7 finds zero ids in authored files; a T3-shaped id (`thread:delegated-task:command%3Amcp%3A…`) round-trips through every Pe store keyed on a thread | none | TS package tests | 1 |
| 3 | Unblock Pea | Pea's native tools run; consent fires only on a guarded act | `isPeaTool` and the native refusal in `harness/threads.ts`; the `!footprint.length` trigger in `control.ts`; `chat.autoApprove` with its reader, `ConsentSink.autoApprove` and the "awaiting approval" rows, in the same change that narrows consent; the unbounded consent wait; the three stale gate descriptions; the hosted parser path and the remote gateway on `t3/pea-muas-retest` (a trimming commit, then the branch merges; no cherry-pick) | R1: one permission request per ACP tool kind is allowed, read from the fake agent's record; R2: the set of acts that opens a window equals a literal list of three; R3: on a fake clock every opened window resolves at its deadline | none; `fix/purge2-integrity` landed on main at b2caafd3 and in `crusade/homes` at 74d10111 | host tests; J1 on the dev session through the CLI | 2 |
| 4 | One decode helper, one write helper | the two failure policies in code; the discard notice | every throw-at-start parse (scheduled tasks, devices, remote ingress, share, update reader, captures, route settings, journal snapshot, Page event log); Work's private discard block in `route-document-store.ts`; 29 hand-written temp-then-rename writes | per class, one seeded corrupt file: an authored file is listed "can't read, kept" with bytes unchanged; a Work file is gone with exactly one notice; host start throws 0 times | none; `fix/purge2-integrity` landed on main at b2caafd3 and in `crusade/homes` at 74d10111 | host tests | 2 |
| 2 | Carriers | one in-model mechanism (`ProjectInfoText`, one hidden parameter per owner, ADR 0032) and one envelope `{owner, version, data}`; the unknown-version rule; a slot for the project pointer | the unversioned AutoTag blob shape; any owner blob with no envelope; the contradiction between the Takeoff comment that bans Extensible Storage and the duct losses store that uses it. Extensible Storage stays banned, and the duct losses store is the one written exception (ADR 0032 rule 7; kaitpw: "yes") | on a real model, every owner's blob round-trips through the envelope; a model that carries a future-version blob opens, the blob is refused, and its bytes are not overwritten (ADR 0026 D4) | the Revit lane is free (kernel end gate) | `pe-revit test`, controlled | 2 |
| 8 | Guards | the three choke points | nothing of slice 3's: no interim window is built. Slice 8 adds only the pre-event that cancels a project save or synchronize inside a Pea script | H7a, H7b, H7c; every guard test ships a named mutant that turns it red and a sentinel proving its scan is not empty; a family save from a script is not held | the purger's registry group (main a02b8aea merged a purge-2 registry group; the implementor confirms) and the Revit lane | dev session, controlled; a local central; a stub upload server | 2 |
| 5 | Content homes hold only authored things | the agent's working directory; where run output, Work and Page state live | `Pods/<pod>/output/<runId>`; `<user>/Work` inside OneDrive; `Pages/<slug>/.state`; `.vscode/settings.json` and the machine-derived entries of `PeScripts.csproj` inside a pod (the csproj itself stays, freeze shape 8); harness projections in the user root; the "Conflicting personal skill copies" read-back | guard M1: two "machines" (different state root, port and install root, asserted different) bootstrap one temp home, and the home is byte-identical apart from create-exclusive new files | kernel slice 10 /family lands | host tests; `pe-revit test` for the C# run writer | 2 |
| 6 | Homes | the marker; three tiers; the firm home found with no env var; the one write door; the safety net; the duplicate-id refusal; the project pointer | `userTwin` and `userWritable` (copy-on-write); the first-by-id shadow in `listPackages`; `PE_TOOLS_SHARED_ROOT` as the only discovery; the `keyRefusalText` line that tells a person to set it; the `Firm/` folder name | H1 to H4; a host with no `PE_TOOLS_*` variable finds the firm home; a write to a shared pod changes the share's bytes and makes no user copy | the kernel crusade ends | two hosts on one machine; Windows Sandbox; a scratch folder on G: | 3 |
| 6b | Tiered settings | the `setting` binding kind; the project tier; write doors for firm and project; the `/settings` sheet | the Page field role `setting` (ADR 0026 line 29 and D6 are amended here); the route-settings store (`host/src/route-settings.ts`, `web/src/shell/settings.ts`); `/settings`'s hand pane; Work-only friction and parameter slot names | FS | the kernel crusade ends, and slice 6 | two hosts on one machine; dev session | 3 |
| 9 | Shared derived outputs | a parse is stored once and found by a second person | re-parsing per call; vendor downloads in the user root or a temp folder | J2: zero documents parsed again; the census counts zero shared files whose name does not match their bytes | slice 6 | two homes | 3 |
| 10 | T3 | the agent engine | every row of [T3-CUTOVER.md](T3-CUTOVER.md) | F1 to F11, then the flip rule | the Revit lane is free; touches no storage slice | dev session with the T3 sidecar | parallel track |

### Timing plan (implementor, 2026-11-11, supersedes the first waves)

Four read-only censuses at a02b8aea re-checked the slice rows (the implementor thread; each finding a writer needs is restated in its brief). They changed the plan in four ways:

- The Gate column holds landing, not writing. `fix/purge2-integrity` shares no consent file with slice 3. Every slice is written now, and only the merge to main and the Revit proofs wait.
- Slices 3 and 8 are one consent change. Pea's own doors (`instances.save`, `stop`, `close`, `reset`, `restart`, `cleanup`, the upload) return "held" directly from the host, which already reads `isModified` (`ts/apps/host/src/machine.ts:954`). No interim window is built. Only a save inside a script needs the Revit pre-event. A script run holds Revit's API context, so a person cannot press Save during one, and a save that fires while a script runs is Pea's. Assumption A shrinks to "a pre-event can cancel".
- Slices 5 and 6 are one coupled decision: the state-root layout, the agent's working directory (it also sets the world id, `ts/apps/host/src/local-ops.ts:40`), and C# being handed a pod's absolute folder instead of joining a name onto the user's Pods (`dotnet/Pe.Revit.Scripting/Pods/ScriptPodPreparationService.cs:157`). The freeze shapes below settle them once, before either is written.
- Main already sends file bytes to LlamaCloud (`ts/apps/web/src/routes/api/pdf-audit/parse.ts:17`), so guard 3 covers main's path as well as the branch's.

Waves. The integration branch is `crusade/homes`. Each writer is a Fable 5.2 child in its own worktree, proving with typecheck and touched tests.

| Wave | Writer | Slices | Hours | Waits on |
|---|---|---|---|---|
| 0 | implementor with kaitpw | the freeze shapes below | 2 | nothing |
| 1 | A consent | 3, the TS half of 8; merges `t3/pea-muas-retest` with the gateway deleted; deletes the route-settings store (its one field is `chat.autoApprove`) | 7 | nothing |
| 1 | B store kernel | 4; the write door, compare-and-swap and safety net as modules; adoption in files no other writer owns | 5 | nothing |
| 1 | C carriers | 2 in C#, compile and `Pe.Shared.Tests` | 4 | nothing |
| 1 | D names | 1, and 7 reduced to hashing ids used in paths | 2 | nothing |
| 1 | E standards | 0, and the Drive revision spike (assumption B) | 2 | nothing |
| 1 | F homes C# | the C# halves of 5 and 6 | 5 | wave 0 |
| 1 | G1 homes TS | 6: resolver, home list, listing, duplicate refusal, door adoption, copy-on-write deleted | 5 | wave 0, B's door module |
| 1 | G2 homes TS | 5: Work, Page state, run output and the working directory moved to the state root | 5 | wave 0 |
| 2 | one batched Revit contact | carrier round-trip, the pre-event spike and its small C# subscriber, the C# run writer, the pointer write on both clones (assumption C) | 3 | the kernel's Revit lane |
| 2 | H settings | 6b, then 9 | 6 + 3 | the kernel ends, G1 |
| 3 | driver | the final drive | | everything |

The critical path is wave 0, then G1, then the kernel's end, then H. The kernel's end is the one gate this crusade does not control. Main takes the `crusade/homes` tip at the first green full suite after the kernel crusade lands its last merge. The driver starts now on lanes that need no Revit. The T3 track runs beside this table and is not on its critical path.

### Freeze shapes (wave 0, for kaitpw's review)

Each line is the stored bytes a coworker will come to hold. A writer codes against these and moves each into code or `ts/packages/host-contracts/tests/runtime-ownership.fixture.json`, which already pins the TS, C# and PowerShell resolvers to one table.

1. Marker: `pe-home.json` holds `{"tier":"user"|"project"|"firm"}` and nothing else.
2. Layout of every home: `Pods/`, `Pages/`, `Catalogs/`, `Settings/<owner>.json`. The user home adds `Skills/`. The firm home adds `keys.json`. `preferences.json` at a home root folds into `Settings/preferences.json`. No home root holds `AGENTS.md`, `README.md` or `output/`.
3. Firm home: on each drive letter, `<L>:\Shared drives\*\04 PE Software Files\Pe.Tools` and `<L>:\04 PE Software Files\Pe.Tools`, accepted only when the marker reads `firm`. On kaitpw's machine it is `G:\Shared drives\PE Team Folder\04 PE Software Files\Pe.Tools`. The shared drive root is the folder that holds `04 PE Software Files`. `PE_TOOLS_SHARED_ROOT` stays as a dev override only. It names the firm home itself and skips the probe. With or without it, the shared drive root is the firm home's grandparent. Two firm markers found by the probe are a conflict: both are refused with one notice that names both paths, as for a duplicate pod id.
4. Project pointer: one in-model owner blob `{"owner":"project-home","version":1,"data":{"path":"<folder>/<folder>"}}`, a forward-slash path relative to the shared drive root, with no drive letter. Pe's files sit in `<path>/Pe.Tools`, which carries a `project` marker.
5. In-model envelope: `{"owner":"<owner>","version":<int>,"data":{…}}` in one hidden text parameter per owner. An unknown version is refused, and its bytes are never overwritten.
6. `$schema`: `/schemas/settings/<module>/<root>.json`, the existing `SettingsSchemaUrl.Path` form, with no origin. The host resolves it. Editor completion is not required.
7. Machine state root: the existing resolver, unchanged. Under its `state\` folder, through `productStatePath`, beside every state file that already survives an MSI upgrade: `Work/`; `Pages/<slug>/` for Page state; `Runs/<pod-id>/<run-id>/` for run output; `Blobs/sha256/<hash>` for the safety net; `T3/` for the T3 home; `Agent/` for the agent's working directory, which holds the harness projections, the agent's `AGENTS.md` and the generated script workspace. Pod and Page ids are unique across homes, so no key names a home.
8. Script workspace: `PeScripts.csproj` stays in the pod as an authored file, so an offline `dotnet build` of a pod still validates it. It holds only the references a person adds and exactly one machine-independent import, `<Import Project="$(LOCALAPPDATA)\Positive Energy\PeScripts.props" />`, spelled the same on every machine. Bootstrap writes that props file per machine, outside every home and outside the installed root (dev state may not enter the installed namespace), with the machine's Revit and Pe assembly paths. One props file serves every lane, checkout and Revit year of one OS user, and the last bootstrap wins (an accepted ceiling for an offline check). The import has no `Exists` condition, so a machine that never bootstrapped fails with MSB4019 naming the props file. The in-Revit compile reads only the authored references from the csproj and adds the machine references itself, as it does today. `.vscode/` and the bootstrap-rewritten `AGENTS.md` leave the pod for `Agent/`.
9. Secret role names in `keys.json` and the person's own store: `openai.api-key`, `anthropic.api-key`, `llamaparse.api-key`. LlamaParse moves off the web server's environment onto this resolver.

Settled 2026-11-11 by G2 from the SDK MSI author (Pe.Revit.Sdk 1c0cb91, `MsiCommand.cs` `RequireNotMutable`): an upgrade never clears a path with a `state`, `logs`, `cache` or `data` segment, so `<root>\state\` survives. A new top-level folder beside `bin\` would not be guarded. PROVEN[source read and disk dates], not by a run upgrade.

### Assumptions that no run has checked

The owner: "we need to be relient if these assumptions dont hold, but I think they will." Each assumption has a spike and a named fallback.

| # | Assumption | Spike | Fallback if it fails |
|---|---|---|---|
| A (PROVEN 2026-11-12, decision log) | Revit's cancellable pre-events (`DocumentSaving`, `DocumentSavingAs`, `DocumentSynchronizingWithCentral`) can hold Pea's save or synchronize on a project document and can tell Pea's save from the person's. No C# file in the repo subscribes to them at a02b8aea. | inside slice 8, on the detached Chadds clone, before the guard is built | Pea scripts and Pe's own save helpers refuse the save and synchronize API entities for project documents. Family documents stay free. |
| B (PROVEN 2026-11-11, see decision log) | Google Drive keeps usable revisions of a non-Google file on the shared drive, and two writes seconds apart do not lose the pre-write bytes. | census C5 in wave 1, on a scratch folder on G: | The Pe-side prior-bytes net is the only net. A second machine cannot restore, and the written promise says so. |
| C | The project pointer can be written as an ordinary model write on a cloud workshared model, and others see it after a synchronize. | inside slice 6, on the cloud throwaway `chadds_clone_aug_11` | The firm-home index of `POSITION-v3` amendments 1 to 3: one small file per project in the firm home, keyed by `projectGuid` and `modelGuid`. |

### Deliberately unbuilt

- A restore verb or restore UI, retention and pruning of prior bytes, and any wider reversibility. Model reversal is included (ADR 0027 rule 12 stands). kaitpw: "the full force of this can be defered, but we need to set the kernel up for it for sure."
- A run-registry split out of the consent service. Narrowing the trigger keeps the registry whole.
- A catalog-wide `consequence` metadata axis. Three choke points feed one predicate.
- Cleanup or migration code for files that nothing reads (`access.json`, `inference-endpoint.json`, `mastra.db`, `route-work`, `CmdFF*`, `%LOCALAPPDATA%\Pe.Tools`). The owner deletes them by hand on one machine.
- A project inventory store, findings in the project home, and journeys J3 and J4 of `muse/round3/journeys.md`. They are not in this crusade's end gate.
- A coworker-machine proof inside the end gate. It is owed at the first real release.

## Deletion criteria

- A slice lands only when its falsifier is green at the landed SHA and every item in its Deletes column is gone.
- A guard is admitted only when a named mutant turns it red, and its scan asserts that a known sentinel is in its input set.
- Deletion is the ratchet for a deleted switch. No guard is written for `autoApprove` or `isPeaTool`, because a re-add is a new symbol in review.
- No slice writes migration code. A stored thing whose shape changed is refused and kept (authored) or discarded with a notice (the rest).
- A deletion in a file the T3 cutover deletes is free. An addition there is not: see the do-not-invest list in [T3-CUTOVER.md](T3-CUTOVER.md).
- kaitpw: "love it! I wanna delete as much as possible!"

## Risk tier per surface

| Surface | Tier | Why |
|---|---|---|
| The write door and the safety net (slice 6) | integrity | two people write the same bytes on a synced drive |
| In-model carriers and the project pointer (slices 2, 6) | integrity | they write into client models and are frozen |
| Guards (slice 8) | integrity | a miss saves or synchronizes a client model, or sends a client file out |
| Failure policies (slice 4) | integrity | a wrong class deletes authored work |
| Content home cleanup (slice 5) | integrity | Work and run output move; a wrong move puts SQLite on Drive |
| Secrets (slices 3, 6) | integrity | a firm key reaches every machine that finds the firm home |
| Tiered settings (slice 6b) | integrity | a wrong tier label is a provenance lie on an engineering value |
| Names (slice 1), thread refs (slice 7) | contract | frozen stored names |
| Standards (slice 0) | presentation | a classified list and a backup; no code path |

## Decision log

- 2026-11-12, C# implementor default, re-openable: `DocumentColorLedger` is `keep` because it contains user preferences. Palette usage CSV, family snapshots and geometry packs are `discard` because they are derived. `StoredFile` in `Pe.Shared.StorageRuntime` posts the TS notice shape to the same `stored-notices.jsonl` feed. Geometry index-capacity refusal keeps structurally valid bytes and posts a notice; corrupt packs are discarded.
- 2026-11-12, kaitpw, from the purger: "make it required in the snapshot contract and delete the `?? null` collapse, so that a missing field is a contract error and not a silent null." `projectHome` is required and nullable; families and models with no pointer send null.

- 2026-11-11, kaitpw: three home tiers ship. "id prob say all three teirs". This amends ADR 0032 line 129.
- 2026-11-11, kaitpw: authored files are refused and kept; Work, journal and threads are discarded with a notice; nothing stops the host. "agree".
- 2026-11-11, kaitpw: consent is a notice. "I wanna move towards safteynets and notices, not guardrails."
- 2026-11-11, kaitpw: a firm API key and personal subscriptions both work. "I need both! non negotiable."
- 2026-11-11, kaitpw: tools write to G: ungated. "yes tools should write, i dont think really any writes to anywhere in gdrive should be gated."
- 2026-11-11, kaitpw, "yes to all rulings" on the list in `POSITION-v3`: a duplicate pod id across homes is refused with a notice; the three guards stand; T3 is in with the flip rule; the driver may have a scratch folder on G:.
- 2026-11-11, kaitpw: the firm home is `04 PE Software Files\Pe.Tools`. "direct child of 04 software files, maybe rename my current 'Pe.Tools' to something else, i planned to delete it soon anyways."
- 2026-11-11, kaitpw: the project home is the folder the humans use, and the model points at it. This replaced the firm-home cloud index.
- 2026-11-11, kaitpw: the safety net is set up now and filled in later.
- 2026-11-11, kaitpw: T3 only "if it properly deletes, replaces, and integrates everything in that research list"; a trailing purger enforces it.
- 2026-11-11, kaitpw: the coworker-machine bar "can be soft-ish"; every journey ships as a scripted runbook.
- 2026-11-11, kaitpw: Extensible Storage stays banned, with duct losses the one written exception. "yes".
- 2026-11-11, kaitpw: Pe's child folder in a project folder is named `Pe.Tools`. "Pe.Tools also?"
- 2026-11-11, kaitpw: the real Chadds model is never saved or synchronized; the detached clone and the cloud clone are throwaway. "its a throwaway clone so anyw rites are allowed. we also have chadds_clone_aug_11 which is cloud and throwaway."
- 2026-11-11, kaitpw: "the guard, whatever it is, should only guard against save/sync for projects, not families."
- 2026-11-11, kaitpw: "agreed on phasing with kernel crusade."
- 2026-11-11, muse default, re-openable: the second drive lane is Windows Sandbox for install and upgrade, a second Windows profile for first run with Revit, and a coworker's machine only as a scripted runbook at the first real release. The owner asked to learn about a second Windows profile before ruling.
- 2026-11-11, muse default, re-openable: which files are standards is not ruled. Slice 0 produces the classified list (real, test, proof, WIP, archive, one-off, no registered library, dangling reference) for the owner to tick.
- 2026-11-11, five consulted threads (T3 research, journeys, and forks of the kernel implementor, purger and driver) signed `POSITION-v3`. The purger and driver forks were limited handoffs and marked their claims "from records".
- 2026-11-11, kaitpw, on the implementor's re-plan: "i resonate with everything you've said, especially the wave squashes." Writing starts for every slice now; only landing and Revit proofs wait.
- 2026-11-11, kaitpw: `t3/pea-muas-retest` has no other writer. "noones working on it, do what u wan". Writer A merges it with the gateway deleted.
- 2026-11-11, kaitpw: editor completion for `$schema` is not required. "its not a requirement. occam".
- 2026-11-11, kaitpw: the driver starts now, and Revit and host runs are free when the machine has room. "the only constraint we have is too many revits while the kernel crusade is running ... I honestly dont care when u run revit/host etc."
- 2026-11-11, implementor default, re-openable: no interim consent window. Slice 3 ships the "held" returns for Pea's own doors; slice 8 adds only the pre-event for saves inside a script.
- 2026-11-11, implementor default, re-openable: `RunRef` gets no engine tag. Runs live only in discard-class stores, so a tag added at the T3 cutover needs no migration.
- 2026-11-11, implementor default, re-openable pending kaitpw: in-model blobs use one envelope on two anchors, Project Information for project-level owners and hidden element parameters for Takeoff's per-region blobs.
- 2026-11-11, kaitpw: Takeoff's per-region blobs keep their element anchor. "architecturally it still makes the most sense to me. agreed on ur default". One envelope, two anchors.
- 2026-11-11, kaitpw: no engine tag, now or later. "i dont see why we'd add a tag at all. i think itd be unnecessary even if we kept both".
- 2026-11-11, kaitpw: the T3 track gets its own implementor partner. "yes you may start your own partner. keep in communication about it where it matters".
- 2026-11-11, kaitpw: freeze shapes 3 and 4 stand: the firm home under `04 PE Software Files`, and the pointer relative to the shared drive root. "relative to shared drive is fine". The old `Pe.Tools` folder there held installer harvests; kaitpw: "you can rename that folder (i dont care what)". The implementor renamed it to `Pe.Tools-install-harvests` the same day.
- 2026-11-11, kaitpw on freeze shape 8: offline `dotnet build` of a pod is a useful validation path ("useful validation path (becuase its offline, ie not requiring host or revit)"). Shape 8 is rewritten so the authored `PeScripts.csproj` stays in the pod and imports machine paths from a per-machine props file.
- 2026-11-11, implementor defaults on the driver's first read, re-openable: H7c's confirm is the Send control on the held act's notice row, and H7a and H7b have no window to leave open. A person's own Save or Synchronize is stood in by `pe-revit doc save` outside Pea and outside a script, stamped as a stand-in, plus one owner hand step at the end gate. Person B's halves of FS, J2 and the H3 cloud variant run in one batched session swap. H4 witnesses through a host read of the value and its tier, and the /fans label moves to FS. H1's Pea question runs on the CLI lane, so no key enters the Sandbox guest.
- 2026-11-11, assumption B PROVEN[Drive API `revisions.list` on `_pe-homes-scratch/probe.json`, file id 10p91BBcf1U5npdvaSRovF4lOvRq-is1Y: three revisions, each md5 equal to the local v1, v2 and v3 bytes, v1 and v2 written 8 s apart]. Drive keeps the pre-write bytes of a non-Google file on the shared drive, and a second machine can restore through Drive's version history. Writer E's local-log reading of two revisions was wrong. The Pe-side net stays as built, as the first net.
- 2026-11-11, kaitpw on slice 0: "the classifications looks right to me." A standard is a JSON that normalizes a project's parameters to a shape and displays them: Family Foundry JSONs and schedule JSONs. "CustomFams are importnant", as standards "in a kinda indirect sense". Equipment-specific files are kept for posterity. The Family Foundry files predate the rewritten engine's schema and show as "no registered library"; migrating them is the owner's own work, not crusade code.
- 2026-11-11, implementor default on old in-model blobs, from kaitpw: "no, i dont think any projects have those client models yet. im split between manual reapply and blind overwrite. my main concern is that I dont wanna have wire a whole other path to show this error." A blob with no envelope reads as absent: the owner starts from defaults, and the next write overwrites it, so no error path is wired. A blob with an envelope and an unknown version is refused and kept (ADR 0026 D4), through the refusal value the kit already shows.
- 2026-11-11, kaitpw on subagent effort: "step down the thinking on future fables. high isnt banned but I think medium is usually a better starting point and itll get us more bang for buck." New Fable 5.2 children start at medium. A child goes to high only when its task is judgment-heavy and integrity-tier, and its brief says why.
- 2026-11-11, implementor default from the purger's census C1, re-openable: classes for the stored kinds ADR 0039 does not name. `plugins.json` and `route-trust.json` are a person's trust decisions, class `keep`. `share.json` and APS `tokens.json` are `discard`, because pairing again or signing in again is the recovery. Route settings are deleted by slice 3. `install.json` is `discard`, and its id is minted again. `host-source-*` stays out of "Deliberately unbuilt", because `machine.ts:1057` reads it and `host-lifecycle.ts:381` sweeps it.
- 2026-11-11, implementor, from C1 and C2: `remote-ingress.json`, its reader and its wiring are deleted in slice 4. No coworker holds the file, no code writes it, and T3-CUTOVER lists it under "Replace outright".
- 2026-11-12, implementor default from writer B's question, re-openable: an append-only log (`receipts.jsonl` at `captures-route.ts:130`, the Page `events.jsonl`) is decoded per line. A line that fails to decode is left out of the read and posts one notice, de-duplicated by path and line hash. The read never rewrites the file, and appends continue after it. A whole-file discard would drop every good receipt to recover from one torn line, and a crash mid-append tears only the last line.
- 2026-11-12, implementor accepts writer S8's defaults (`dafc487e`), re-openable. A save-as inside a script run is held only when its target file already exists, which matches journey H7a and writer A's `guardSave`. A save-as to a new path is not held. The run scope covers every script `Execute`, so a pod a person starts from the palette is held too: a pod never saves a project, and the person saves. If `Cancel()` cannot stop an API-started save (assumption A), the fallback is a `ScriptPolicyAnalyzer` rule refusing `Document.Save`, `SaveAs` and `SynchronizeWithCentral`, with family saves through the `FamilyDocument` helper.
- 2026-11-12, implementor: assumption A PROVEN on the fresh rung at 72369c85, on a copy of the detached Chadds clone (sha256 7183efe9…bd2d). `ScriptSaveHoldTests`: 5 passed. A script's project save, synchronize to a local central, and save-as over an existing file are cancelled at the pre-event, report "Held, not done: …", and leave the file's sha256 and modified time unchanged. A family save from a script and a save outside a run write their files, and a sentinel shows the pre-event fired for both. Mutant "never cancels" (`ScriptSaveHold.cs:50`): 3 held tests red, 2 not-held tests green. Results `.artifacts/test-results/pe-revit-fresh-20261112T010340723.trx`, mutant log `.artifacts/tmp/revit-batch2-mutant.log`. Still UNPROVEN: the final run status of a script that does not catch the held save, because the tests' status lines did not reach the trx.
- 2026-11-12, implementor default on writer B's question, re-openable by kaitpw: a corrupt action journal and a corrupt update admission are class `keep`, not `discard`. This departs from ADR 0039 rule 1 for these two kinds. Both hold authority over writes whose outcome may be unknown. Discarding them lets a replayed admission dispatch a model write again, or lets an update apply twice, and neither can be undone. `docs/features/host/LEDGER.md:235` says "Authority recovery must fail closed". So the host still starts, refuses new actions or applies with the kept file's path and reason, and a person removes the file to recover. A journal of a known older version is still discarded with a notice.
- 2026-11-12, kaitpw on merge cost: "quick and dirty is always best for implementation, rely on purger and driver for quality. by extension, small conflicts are ok. weight what it takes to solve the conflict, with how long itll take to implement the thing. choose your own based on what you measure, id think like 1:8, where 8 is plus/minus 3. usually getting the work done and drivable is more important than easy integration because thats where the real signal is". Restated: writers run in parallel even over shared files; a conflict that costs about one eighth of the work it unblocks is fine; small review findings batch into the writer's next round, not a round of their own; a slice is done when the driver drives it, not when it merges.
- 2026-11-12, kaitpw: "make sure you never forget abt the driver, they are your proof bar". Every merged tip goes to the driver, and a slice counts as landed only after a driver journey on it.
- 2026-11-12, kaitpw on targets (T3 spike F3): "pea should be able to call on any target it wants, the user's target is the default, which i think means 'only suggest'". Restated: a thread's target is a default. A Pea call naming another document is allowed. F3's prediction is expected behaviour, not a defect, and no refusal is built. ADR 0021 stands as written.
- 2026-11-12, kaitpw on the fail-closed default (59d4f336): "if it a manual delete im quite opposed. its a little moot since pea can fix it, so maybe its not worth extra machinery, but its a UX smell." Restated: no state may need a person to delete a file. The 59d4f336 default is reversed. A corrupt action journal or update admission is discarded with one notice, as ADR 0039 says. Its bytes go to the blob store first, so nothing is lost. A retried admission whose id the fresh journal does not know is refused, never dispatched as new.
- 2026-11-12, kaitpw on the composer estimate: "this is almost certainly not correct. case in point is that we've landed 2500k+ commits in 2 weeks with over 100k lines of code churned total. i would like to learn more about what is so complicated about the composer too. lets make sure that none of these fixesa re surface level." Restated: the 6 to 12 day estimate is not accepted. It is re-measured at this repo's real pace, and a non-author (the purger) checks that the port plan reaches the real seams.
- 2026-11-12, kaitpw on the firm home: "yes create firm home". Restated: the real firm home exists at `G:\Shared drives\PE Team Folder\04 PE Software Files\Pe.Tools`, holding only `pe-home.json` (`{"tier":"firm"}`) plus empty `Pods\` and `Settings\`. The implementor created it on 2026-11-12. Content and keys go in later.
- 2026-11-12, kaitpw on the composer's open run: "memory only is fine and probably preferable". Restated: an open run lives only in host memory. A restarted host has no open runs, and the next Pea turn opens a fresh run with one new notice. The port does not persist `runConsent` or anything in its place.
- 2026-11-12, kaitpw on target pinning: "this smells, but yeah lock on t3 start i guess". Restated: a turn's default target is read once, when its T3 run starts, and forks and delegates inherit it. Because targets are context only (ADR 0024) and Pea may name any target, this pins only a suggestion. The smell stays open: the composer wave asks whether any pin is needed at all.
- 2026-11-12, implementor default on the T3 flip, re-openable by kaitpw: line 1. F4's missing notice link and F5's missing tool abort count as Pe fixes, not fails. The flip still waits on F11, the owner's sign-in step.
- 2026-11-12, kaitpw on CI: a private repo under positive-energy-labs hosts the `Pe.Revit.Sdk` package family on GitHub Packages; "sure" to allowing `pnpm/action-setup`; the format and lint sweep runs "whenever you think best", which the implementor sets as right after homes and kernel both merge.
- 2026-11-12, kaitpw on the T3 line: "I wonder if we should pause the t3 line, or only do the parts of it that relate tot he real home stuff... because itll take so long its just background noise for you, and it was never critical." Restated: T3 is parked until homes lands. `crusade/t3` keeps its spike results and the Sol fixes. `t3/CUTOVER-PLAN.md` is the restart point. Harness-neutral fixes found there, such as MCP abort forwarding and the native cancel split, may be harvested into homes only where a homes journey needs them. The flip (Q7), the F11 sign-in (Q8) and the F6a root (Q12) wait with it.
- 2026-11-12, kaitpw, C2 round 2: "An append log's torn tail is its normal crash state, and the geometry is costly to re-extract." `LinkedGeometryStore` truncates to the complete prefix, evicts only a failed-checksum entry, and discards a whole pack only for a bad header. This supersedes C2's whole-pack discard on a torn tail and its notices for index-capacity or IO refusal. Only decode refusals post stored-file notices; write and IO failures log.
