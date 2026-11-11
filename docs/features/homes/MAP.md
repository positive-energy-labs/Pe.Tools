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
| 7 | Thread refs | nothing authored holds a thread or run id; a ref carries its engine tag | raw thread or run ids used as path segments outside the do-not-invest zone | census C7 finds zero ids in authored files; a T3-shaped id (`thread:delegated-task:command%3Amcp%3A…`) round-trips through every Pe store keyed on a thread | none | TS package tests | 1 |
| 3 | Unblock Pea | Pea's native tools run; consent fires only on a guarded act | `isPeaTool` and the native refusal in `harness/threads.ts`; the `!footprint.length` trigger in `control.ts`; `chat.autoApprove` with its reader, `ConsentSink.autoApprove` and the "awaiting approval" rows, in the same change that narrows consent; the unbounded consent wait; the three stale gate descriptions; the hosted parser path and the remote gateway on `t3/pea-muas-retest` (a trimming commit, then the branch merges; no cherry-pick) | R1: one permission request per ACP tool kind is allowed, read from the fake agent's record; R2: the set of acts that opens a window equals a literal list of three; R3: on a fake clock every opened window resolves at its deadline | `fix/purge2-integrity` lands (at a02b8aea it has not) | host tests; J1 on the dev session through the CLI | 2 |
| 4 | One decode helper, one write helper | the two failure policies in code; the discard notice | every throw-at-start parse (scheduled tasks, devices, remote ingress, share, update reader, captures, route settings, journal snapshot, Page event log); Work's private discard block in `route-document-store.ts`; 29 hand-written temp-then-rename writes | per class, one seeded corrupt file: an authored file is listed "can't read, kept" with bytes unchanged; a Work file is gone with exactly one notice; host start throws 0 times | `fix/purge2-integrity` lands | host tests | 2 |
| 2 | Carriers | one in-model mechanism (`ProjectInfoText`, one hidden parameter per owner, ADR 0032) and one envelope `{owner, version, data}`; the unknown-version rule; a slot for the project pointer | the unversioned AutoTag blob shape; any owner blob with no envelope; the contradiction between the Takeoff comment that bans Extensible Storage and the duct losses store that uses it. Extensible Storage stays banned, and the duct losses store is the one written exception (ADR 0032 rule 7; kaitpw: "yes") | on a real model, every owner's blob round-trips through the envelope; a model that carries a future-version blob opens, the blob is refused, and its bytes are not overwritten (ADR 0026 D4) | the Revit lane is free (kernel end gate) | `pe-revit test`, controlled | 2 |
| 8 | Guards | the three choke points | the interim consent window that slice 3 left on the guarded acts, which a "held" return replaces | H7a, H7b, H7c; every guard test ships a named mutant that turns it red and a sentinel proving its scan is not empty; a family save from a script is not held | the purger's registry group (main a02b8aea merged a purge-2 registry group; the implementor confirms) and the Revit lane | dev session, controlled; a local central; a stub upload server | 2 |
| 5 | Content homes hold only authored things | the agent's working directory; where run output, Work and Page state live | `Pods/<pod>/output/<runId>`; `<user>/Work` inside OneDrive; `Pages/<slug>/.state`; `PeScripts.csproj` and `.vscode/settings.json` inside a pod; harness projections in the user root; the "Conflicting personal skill copies" read-back | guard M1: two "machines" (different state root, port and install root, asserted different) bootstrap one temp home, and the home is byte-identical apart from create-exclusive new files | kernel slice 10 /family lands | host tests; `pe-revit test` for the C# run writer | 2 |
| 6 | Homes | the marker; three tiers; the firm home found with no env var; the one write door; the safety net; the duplicate-id refusal; the project pointer | `userTwin` and `userWritable` (copy-on-write); the first-by-id shadow in `listPackages`; `PE_TOOLS_SHARED_ROOT` as the only discovery; the `keyRefusalText` line that tells a person to set it; the `Firm/` folder name | H1 to H4; a host with no `PE_TOOLS_*` variable finds the firm home; a write to a shared pod changes the share's bytes and makes no user copy | the kernel crusade ends | two hosts on one machine; Windows Sandbox; a scratch folder on G: | 3 |
| 6b | Tiered settings | the `setting` binding kind; the project tier; write doors for firm and project; the `/settings` sheet | the Page field role `setting` (ADR 0026 line 29 and D6 are amended here); the route-settings store (`host/src/route-settings.ts`, `web/src/shell/settings.ts`); `/settings`'s hand pane; Work-only friction and parameter slot names | FS | the kernel crusade ends, and slice 6 | two hosts on one machine; dev session | 3 |
| 9 | Shared derived outputs | a parse is stored once and found by a second person | re-parsing per call; vendor downloads in the user root or a temp folder | J2: zero documents parsed again; the census counts zero shared files whose name does not match their bytes | slice 6 | two homes | 3 |
| 10 | T3 | the agent engine | every row of [T3-CUTOVER.md](T3-CUTOVER.md) | F1 to F11, then the flip rule | the Revit lane is free; touches no storage slice | dev session with the T3 sidecar | parallel track |

Order inside a wave is by collision: slice 5 lands before slice 6, or run output lands on G: and the pod's machine-specific files flip between machines.

Slice 3 keeps the existing consent window, narrowed to the guarded acts, as the interim guard. Slice 8 replaces that window with the three choke points. This reading joins `POSITION-v2` slice 3 to slice 8 and is the capture's default, re-openable.

### Waves

- **Wave 1, now, while the kernel crusade runs.** Slice 0, the purger's censuses C1 to C7 (defined in `muse/round3/purger.md` section 6 and in the purger's brief), slice 1, slice 7, and the Drive revision spike (C5). No full suite. No Revit. An implementor and a purger. No driver. kaitpw 2026-11-11: "agreed on phasing with kernel crusade".
- **Wave 2, each slice when its named kernel piece lands.** Slices 3 and 4 after `fix/purge2-integrity`. Slice 5 after kernel slice 10 /family. Slices 2 and 8, and anything else that needs Revit, after the kernel's end gate frees the Revit lane.
- **Wave 3, after the kernel crusade ends.** Slices 6, 6b and 9. The driver starts here. The T3 spike takes the Revit lane here.

### Assumptions that no run has checked

The owner: "we need to be relient if these assumptions dont hold, but I think they will." Each assumption has a spike and a named fallback.

| # | Assumption | Spike | Fallback if it fails |
|---|---|---|---|
| A | Revit's cancellable pre-events (`DocumentSaving`, `DocumentSavingAs`, `DocumentSynchronizingWithCentral`) can hold Pea's save or synchronize on a project document and can tell Pea's save from the person's. No C# file in the repo subscribes to them at a02b8aea. | inside slice 8, on the detached Chadds clone, before the guard is built | Pea scripts and Pe's own save helpers refuse the save and synchronize API entities for project documents. Family documents stay free. |
| B | Google Drive keeps usable revisions of a non-Google file on the shared drive, and two writes seconds apart do not lose the pre-write bytes. | census C5 in wave 1, on a scratch folder on G: | The Pe-side prior-bytes net is the only net. A second machine cannot restore, and the written promise says so. |
| C | The project pointer can be written as an ordinary model write on a cloud workshared model, and others see it after a synchronize. | inside slice 6, on the cloud throwaway `chadds_clone_aug_11` | The firm-home index of `POSITION-v3` amendments 1 to 3: one small file per project in the firm home, keyed by `projectGuid` and `modelGuid`. |

### Deliberately unbuilt

- A restore verb or restore UI, retention and pruning of prior bytes, and any wider reversibility. Model reversal is included (ADR 0027 rule 12 stands). kaitpw: "the full force of this can be defered, but we need to set the kernel up for it for sure."
- A run-registry split out of the consent service. Narrowing the trigger keeps the registry whole.
- A catalog-wide `consequence` metadata axis. Three choke points feed one predicate.
- Cleanup or migration code for files that nothing reads (`access.json`, `inference-endpoint.json`, `mastra.db`, `route-work`, `host-source-*`, `CmdFF*`, `%LOCALAPPDATA%\Pe.Tools`). The owner deletes them by hand on one machine.
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
