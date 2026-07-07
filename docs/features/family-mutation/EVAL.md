# Family Mutation Interface — Round-1 Comparative Eval (2026-07-04)

Three pods, three isolated agents, identical proof battery (P0 recon → P1 seed sandbox →
P2 bulk edit → P3 instance edit → P4 rename+migrate → P5 nested → P6 ParamDrivenSolids →
P7 cleanup), all proven live against Snowdon Towers Sample HVAC (Revit 2025). Every claim
below was verified by the supervisor against each pod's `evidence/p*.json` and a final
independent live census (no `PEA-FM-*` marker family survived — all three cleanups real).
Full detail in each pod's `NOTES.md` under `~/OneDrive/Documents/Pe.Tools/workspaces/`.

## Scorecard

| | fam-desired (declarative doc) | fam-verbs (address + verb op-list) | fam-script (fluent navigator, code) |
|---|---|---|---|
| Front door | one desired-state JSON + `scope.surface` selector | ordered op-list JSON, `family/type/instance/nested/param` address grammar + 5 verbs | C# scenario against a `Fam`/`FamilyNode`/`InstanceNode` facade |
| Proofs passed | **8/8** | **7/7 (+probe)** | **7/7 (+probe)** |
| Same-language score | **6/7** (P6 partial) | 5/6 (P6 partial) | 5/6 (P6 partial) |
| Substrate answer to the txn wall | **file-mirror** (`.rfa` mirrors; EditFamily accepted as impossible) | **parked transaction** (dummy famdoc active → project non-modifiable → EditFamily legal) | **deferred ExternalEvent** (schedule in `Execute()`, run after host txn commits) |
| Edits loaded family in place? | **No** — only via workspace `.rfa` mirror (unmirrored family = unreachable) | **Yes** (probe T6/T8) | **Yes** (deferred stage) |
| Compile/harness failures | 1 compile (loose-mode) | 1 local pre-flight only; 0 bridge compile | **2 compile + 1 policy + 1 instantiate + 1 arg** (all P0 harness bring-up); **0 in scenario code** |
| FamilyFoundry reuse | FF PDS compiler (P6) + tried FF apply (unusable) | none (raw API + `DocumentSandbox`) | FF PDS apply (P6) + `ApplyFamilyProfile` refs |
| Rename encoding | declarative `wasNamed` provenance | imperative `rename` op, `migrateValues`/`rewriteFormulas` as verified assertions | `.Params.Rename(...)` verb |
| Instances | same language, narrower vocab (set-existing-only) | same grammar (`instance:id/param`), confusion answered in result record | separate node type `InstanceNode`, shared addressing/verbs/records |
| Distinct superpower | rename folds into state as provenance; cleanup = `state.absent`; most legible for an agent | one op renames project-wide; migration report IS the result record; cleanest substrate (10-step probe) | 0 scenario compile failures; conditionals/traversal read like LINQ; `.Nested()` a necessity not sugar |
| Weak flank | file-mirror unreachability + FF apply dead-end; heaviest lane workaround | ~700 lines of engine choreography for ~40 of grammar; `apply-solids` only half in-language | second protocol (poll `runs\*.status.json`); deferred stage is "a workaround, not sanctioned" |

## Convergent findings (3/3 independent — treat as facts)

1. **The host single-transaction model is THE constraint, not the Revit family API.**
   `pea` WriteTransaction opens one real transaction on the **active document** via
   `DocumentSandbox.BeginCommit` for the whole `Execute()`, and script-authored
   `new Transaction()` is policy-banned in both permission modes. Consequences, each
   live-verified: `Document.EditFamily` throws when the project (active) is modifiable;
   `LoadFamily`-into-project throws while a txn is open on it; `LoadFamily`-into-famdoc
   **silently returns false** without a txn on that famdoc (the nastiest trap — cost
   fam-script a false-pass at P1 surfaced only at P4). Any family round-trip must route
   around this.

2. **Three different substrate answers all work — and none needs FamilyFoundry's apply
   path.** Parked-transaction (fam-verbs, probe `probe-parked.json` T0–T10 all OK),
   deferred-ExternalEvent (fam-script, `p8-probe.json`), and file-mirror (fam-desired)
   each landed the full battery. FF's own `ApplyDesiredFamilyMigrationProfile`/EditFamily
   is **unusable from scripts for project families** (EditFamily-under-host-txn). Raw
   Revit API + `DocumentSandbox` + `Pe.Revit.Extensions.FamDocument` sufficed for all
   parameter work in every pod.

3. **Geometry is a separate boundary in all three.** ParamDrivenSolids shares the
   document, the scope, and the parameter name-space, but **not the scalar value
   grammar**. All three modeled it as a payload-envelope tenant (`state.solids` /
   `apply-solids` verb / `.Solids.AddPrism` sugar that generates the FF payload). Two
   pods reused FF's PDS compiler; both hit the same defect: **FF PDS apply collapses
   per-type values of bound params** (fam-script P6 caveat; recorded, not chased).

4. **One user-facing language honestly spans all four surfaces.** Every pod scored 5–6
   of 7 proofs speaking one addressing + units + result-record grammar, with only P6
   (geometry) partial. The surface (loaded / instance / famdoc / nested) changed via a
   scope selector or address segment, not via a new dialect. The split the spike was
   hunting is in the **engine**, not the interface.

5. **Instances are a narrower slice of the one language, not a different one.** All three
   kept instance addressing inside the grammar; the only real restriction is that an
   instance can set existing params but cannot declare type-system parameters (that
   belongs to the family/nested surfaces). fam-script made instances a separate node
   *type* but still shared addressing/verbs/records; fam-verbs and fam-desired kept them
   one language with a narrower mutation vocabulary. Convergent: same addressing,
   documented narrower verbs.

6. **Revit's `RenameParameter` auto-rewrites dependent formulas for free** (P4, all three:
   `PE_FM_Depth = PE_OLD_Width / 2` recomputed against `PE_NEW_Width` with no manual
   rewrite), and per-type values survive a rename. Rename-as-transition has **two valid
   encodings**: declarative provenance (`wasNamed`) or an imperative op whose
   before/after detail IS the migration receipt. Neither needed a separate migrations
   subsystem.

7. **Shared-session active-doc/host-txn coupling is a real product-lane gap.** The host
   binds its transaction to whichever document is active; sibling agents (or the user)
   steal the foreground with EditFamily; there is **no script primitive to target a
   specific project doc for writes or to foreground one**. A by-title resolver is not
   enough — mutating a resolved-but-inactive project throws
   `ModificationOutsideTransactionException`. This — not the interface design — was the
   dominant time cost of the campaign across all three pods.

## Divergences (the actual decision space)

- **Substrate choreography quality is not equal.** fam-verbs' **parked transaction** is
  the strongest: one choreography serves both the family-doc lane and the instance lane
  (probe T10 deletes on the project while parked), edits families **in place**, needs no
  file mirrors, and adds no second protocol. fam-script's **deferred stage** is a clean
  API context but forces a poll-a-status-file protocol the skill must teach and is self-
  described as unsanctioned. fam-desired's **file-mirror** is the weakest: it accepted
  EditFamily defeat without discovering parking, so a loaded family **with no `.rfa`
  mirror is unreachable**, and FF's apply path stays dead. Same wall, three ladders —
  parking is the highest rung that holds.
- **Front-door medium is a genuine three-way, and each won its predicted axis:**
  declarative was most legible and folded rename/cleanup into state; op-list made
  project-wide rename one line and turned the migration into a self-contained receipt;
  code made conditionals/traversal trivial and produced zero scenario compile failures
  (the thesis's own feared risk did not materialize).

## Verdict — a unified interface IS reasonable, with two honest seams

The spike's central question ("is one unified model reasonable, and if not where are the
boundaries?") answers **yes** for the user-facing language and **two seams** in the engine:

1. **One addressing + units + result-record language across all four surfaces.** Proven
   3/3. This is what pea should speak. Surfaces are selected by scope/address, never by a
   new dialect.
2. **Seam A — engine substrate (invisible to the author):** loaded family, family doc,
   and nested family are all "reconcile a family document" behind one core; placed
   instances are the element domain. Two engines, one grammar. Do not force instances to
   fake a family lifecycle (fam-script) and do not pretend the family reconciler and the
   instance setter are one engine (fam-desired names this explicitly).
3. **Seam B — geometry:** ParamDrivenSolids is a payload-envelope tenant that shares the
   document, scope, and parameter name-space but keeps its own constrained-geometry
   dialect. Keep FF's PDS compiler; fix its per-type-value collapse before relying on it.

**Recommended port (best-of-all-worlds, to be validated by the pea blackbox round):**

- **Front door:** declarative **desired-state document** as the primary surface
  (fam-desired's legibility, `wasNamed` rename-as-provenance, and `state.absent` cleanup
  are the agent-facing wins), with a **small imperative verb set as the escape hatch**
  (fam-verbs' `set/add/remove/rename` for one-off nudges and for the migration-report-as-
  receipt). This mirrors the MEP round's verdict shape (declarative front door + small
  verb API) and is independently re-derived here.
- **Engine:** fam-verbs' **parked-transaction** choreography (edits in place, one
  choreography for both lanes, probe-proven) as the deterministic middle — NOT the file-
  mirror and NOT (by default) the deferred poll protocol.
- **Geometry:** FF ParamDrivenSolids as a nested `solids` block, after fixing per-type
  collapse.
- **Instances:** first-class in the addressing grammar with a documented narrower verb
  set.

**If forced to port exactly one pod as-is: fam-verbs** — it carried the cleanest
substrate (the only one that edits families in place with a single probe-proven
choreography and no second protocol), the tightest compile story, and a same-language
score within one proof of the leader; its weak flank (engine size, geometry half-in) is
bounded work. Its first upgrade would be adopting fam-desired's declarative front door
over the same executor, since declarative scored highest on same-language and legibility.

## Product findings to feed back (independent of interface choice)

1. **Lane gap:** scripts need a way to target a specific project document for writes (or
   per-agent active-doc ownership). The active-doc/host-txn coupling is the campaign's
   dominant cost and blocks concurrent agents.
2. **A third permission mode** ("host opens no txn, policy still scans") would erase both
   the parked-transaction and deferred-stage hacks — the library could own transactions
   on any document directly.
3. **FF PDS apply collapses per-type values** of bound parameters — a real defect for any
   geometry-on-typed-family workflow.
4. **Silent `LoadFamily`-into-famdoc failure** (returns false without a txn) should throw
   or warn; it produced a false-pass that survived two proofs.
5. **Harness discoverability:** pod.json's compilation-scope effect, the Transaction-ctor
   ban under WriteTransaction, and the syntactic `PeScriptContainer` entrypoint resolver
   are invisible until hit — they cost fam-script its entire 9-run P0 budget.

## Round-2 open items

- Pea blackbox: run the synthesis interface through pea itself (routing, clarify-first,
  loop cost at operator scale), control vs skilled, per the `PEA-BLACKBOX-PROTOCOL.md`.
- Fix FF PDS per-type collapse; then re-prove P6 value preservation.
- Product: prototype the "write against THIS doc" lane primitive or the third permission
  mode, and re-measure concurrent-agent contention.
