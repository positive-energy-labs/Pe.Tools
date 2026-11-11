# homes ledger

Content homes: where Pods, Pages, Catalogs, settings and keys live, how a second person finds them, and what Pea may write there. The live frontier is [MAP.md](MAP.md). The rulings that constrain other features are [ADR 0037](../../adr/0037-three-content-homes-one-write-door.md), [ADR 0038](../../adr/0038-consent-is-a-notice-three-guards-on-project-documents.md), [ADR 0039](../../adr/0039-two-failure-policies-by-class.md) and [ADR 0040](../../adr/0040-t3-is-the-agent-engine-on-a-flagged-track.md). Written 2026-11-11 at main a02b8aea from a read-only muse. Nothing below is built: every Decided line is a ruling, not a proof. Evidence: `.artifacts/runs/homes-crusade-20261111/muse/`. Retention: keep that folder until the MAP is deleted, because the MAP and the ADRs cite its files by name.

## Decided

- 2026-11-11, kaitpw: three home tiers ship: user, project, firm. "id prob say all three teirs".
- 2026-11-11, kaitpw: one failure policy per class. An authored file that does not parse is refused and kept. Work, journal and threads are discarded with a notice. Nothing stops the host. "agree".
- 2026-11-11, kaitpw: run consent is a notice. "your list of sync, save, and upload I think are literally the only things that need guars against. I wanna move towards safteynets and notices, not guardrails."
- 2026-11-11, kaitpw: a firm API key and personal subscriptions both work. "I need both! non negotiable."
- 2026-11-11, kaitpw: tools write to the shared drive with no gate. "yes tools should write, i dont think really any writes to anywhere in gdrive should be gated."
- 2026-11-11, kaitpw: the firm home is the folder `Pe.Tools`, a direct child of `04 PE Software Files` on the shared drive. "direct child of 04 software files, maybe rename my current 'Pe.Tools' to something else, i planned to delete it soon anyways." The folder that holds that name today holds installer harvests ("so i could debug my installer, which is mostly stable now").
- 2026-11-11, kaitpw ("yes to all rulings"): the same pod id in two homes is refused with a notice, and a person forks under a new id. Shadowing by the user copy ends.
- 2026-11-11, kaitpw ("yes to all rulings"): the three guards stand as acts: synchronize with central; overwrite or discard a person's model state; send outward. A firm or project setting can pre-allow the hosted parser.
- 2026-11-11, kaitpw: the guards for save and synchronize cover project documents only. "the guard, whatever it is, should only guard against save/sync for projects, not families." Family Foundry and scripts save family files freely: "to script in ff saving files is a non-negotiable."
- 2026-11-11, kaitpw: the project home is the folder the humans use. "I dont think that the pe.tools root for a project should be different from the root that the humans actually use." The team makes the project folder and points the model at it; "the path is stored in the model, like project info style".
- 2026-11-11, kaitpw: Pe's own files sit in one child folder of the project folder, named `Pe.Tools`, the same name as the firm home. "Pe.Tools also?"
- 2026-11-11, kaitpw: deletion is the goal. "love it! I wanna delete as much as possible!"
- 2026-11-11, kaitpw: the safety net is set up now and filled in later. "the full force of this can be defered, but we need to set the kernel up for it for sure. i say this just so we dont get bogged down on the huge variety of reversible actions that are probably possible in theory". This crusade builds the write door, the compare-and-swap, the prior bytes in the local blob store and the prior hash in the receipt, and nothing more.
- 2026-11-11, kaitpw: T3 is in the crusade under a condition. "Im super down for this, but only if it properly deletes, replaces, and integrates everything in that research list that i included in my original message. this will be a major axis where a trailing purger must enforce the dogma". The rows are in [T3-CUTOVER.md](T3-CUTOVER.md).
- 2026-11-11, kaitpw: J1 includes Pea opening its own document. "muas retest should also involve pea opening its document".
- 2026-11-11, kaitpw: the coworker-machine bar is soft, and every journey ships as a scripted runbook. "the bar for install on a coworkers computer, and everything working as expected, can be soft-ish. Theres just a certain level of uncertainty that we cant test unless we make a real release ... the runbooks for these need to be captured and or scripted so I can run them eaily when that time comes".
- 2026-11-11, kaitpw: Extensible Storage stays banned (ADR 0032), and the duct losses store is the one written exception. "yes".
- 2026-11-11, kaitpw: drive fixtures. The real Chadds model is never saved or synchronized ("usually id always say real model with no sync or save"). Writes go to the detached clone `.artifacts/revit/detached/MEP_YoramLePairArchitects_ChaddsFord_R25_standalone_20261019.rvt` ("its a throwaway clone so anyw rites are allowed") and to the cloud clone ("we also have chadds_clone_aug_11 which is cloud and throwaway").
- 2026-11-11, kaitpw: the three unrun assumptions each get a fallback. "we need to be relient if these assumptions dont hold, but I think they will." The table is in the MAP.
- 2026-11-11, kaitpw: the homes crusade starts with a bounded first wave while the kernel crusade runs. "agreed on phasing with kernel crusade".
- 2026-11-11, from the T3 research thread's record of earlier kaitpw rulings: Codex works on day one, because coworkers hold only OpenAI keys; the Claude CLI stays; Pe carries no T3 patch except for a foundational blocker; if T3 wins it becomes canon; acceptance is proven only through the user's own path.
- 2026-11-11, muse default, re-openable: resolver order for a secret is the person's own key, then the firm `keys.json`. No environment step is added. Secrets are named by role: `openai.api-key`, `anthropic.api-key`, `llamaparse.api-key`.
- 2026-11-11, muse default, re-openable: the second drive lane is Windows Sandbox for install and upgrade, and a second Windows profile for first run with Revit.

## Tried & rejected

- 2026-11-11, a home qualifier on addresses (`home/kind/name`): it changes the frozen names (the contribution key `member:@<pod>/<path>`, the SubjectRef name tuple, the `/pods` `member` field) and puts a machine-local fact into Work keys. The duplicate-id refusal ends shadowing with no qualifier.
- 2026-11-11, a firm-home cloud index (one file per project in the firm home, keyed by `projectGuid`): the owner ruled that the model points at the humans' folder. The index survives only as the fallback for assumption C in the MAP.
- 2026-11-11, backup files inside a home (`<home>/.pe/prior/…`, `.bak`): on a synced drive they sync, clutter, and become authored content. Prior bytes go to the writer's local blob store.
- 2026-11-11, the cloud-library shape (a backend as the truth from day one, the drive unused): it brings back migrations, coordinated across a server and clients, and makes a solo developer the operator of a service. The kernel crusade ruling stands: the storage root goes to a shared drive mount before cloud (routes MAP decision log, 2026-11-10). The only cloud work kept is the rule that authored content holds no absolute path, origin or machine id.
- 2026-11-11, an immutable versions-and-pointers store for shared homes: its own kill criterion fires, because the owner and Pea edit files in the store by hand.
- 2026-11-11, a marker with an id, a display name and a firm link: pod ids are unique across homes, so nothing qualifies by home, and the folder name is the name. One field, `tier`, is enough to make a found path prove itself.
- 2026-11-11, an environment step in the secret resolver: the resolver that exists walks the person's key and then the firm file, and that already satisfies the both-keys ruling once the firm home is found.
- 2026-11-11, splitting the run registry out of the consent service: it is needed only if consent is deleted, and the ruling narrows it.
- 2026-11-11, a catalog-wide `consequence` metadata axis for the guards: three acts, each with one implementation, need three choke points and one predicate.
- 2026-11-11, cherry-picking 65e94ef5 from `t3/pea-muas-retest`: a trimming commit on that branch removes the hosted parser path and the gateway, and then the branch merges.
- 2026-11-11, a guard on opening a model, reading a drive, writing to G:, downloading vendor data, writing a cited catalog row, or a Work edit: none of these is one of the three acts.
- 2026-11-11, banning every Revit API entity that can save, as the first choice of guard: Family Foundry and the base modules save family files, and scripted family saves are non-negotiable. It survives only as the fallback for assumption A, limited to project documents.

## Owed

- Slices 0 to 10 are in [MAP.md](MAP.md); each lands with its red falsifier. Journeys and end-gate targets are in [JOURNEYS.md](JOURNEYS.md).
- The T3 cutover rows, falsifiers F1 to F11 and the flip rule are in [T3-CUTOVER.md](T3-CUTOVER.md). The purger holds that file. No row may end as "both exist".
- kaitpw ticks the classified standards list that slice 0 produces (real, test, proof, WIP, archive, one-off, no registered library, dangling reference). Until then no file is called a standard.
- kaitpw rules the second drive lane after reading about a second Windows profile. One Autodesk licence per named user on a second profile is UNPROVEN[not tried].
- The three assumption spikes in the MAP: the Drive revision spike (census C5, wave 1), the pre-event spike (slice 8), and the pointer write on a cloud workshared model (slice 6).
- The written promise (freeze item 11) has no home yet: what survives an update, the three guards, the honest limit, and the plain statement that inference sends what Pea reads to the model provider. Slice 6 writes it where a coworker reads it.
- Coworker-machine journeys (the Revit half of H1, Drive sync in H2 and H4) are owed at the first real release, as scripted runbooks the owner runs.
- J1 is red on main by design. It depends on three Ducts route defects that the ducts ledger owns on `t3/pea-muas-retest` (the missing ERV taps on MUAS-1, the discharge priced at about twice the walked value, the unnamed in-line units), and on a render-based struck-row read that the agent ledger owns there.
- Still open after `t3/pea-muas-retest` merges, owned by the host and agent ledgers: the gateway sign-in race, the LiteParse binaries in the installed build, and the stale `session-slot` claim with no recovery verb.
- The remote MCP gateway stays on its branch until its send tools have a door that returns "held".
- The driver observed at dfaed397 that per-terminal rows label 0.03 as "firm" while the firm read is refused. FS's provenance target is the falsifier; the fix belongs to slice 6b.
- The comment at `ductsFirmSchema` in `ts/packages/agent-contracts/src/ducts-sheet.ts` names `<user content>/Firm/ducts.json`; the code reads the shared root. Correct it in the commit that renames `Firm/` to `Settings/`.
