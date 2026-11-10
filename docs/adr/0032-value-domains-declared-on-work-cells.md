# 0032: Value domains are declared on Work cells and served by the one field-options door

Date: 2026-11-06. Status: **accepted** by kaitpw on 2026-11-06. The kaitpw rulings are recorded at the end. The storage amendment records the model-storage muse rulings. Source: the governor's muse request on declared option and slot sources, after feedback F5, F15 and F33 (`.artifacts/runs/kernel-crusade-20261104/meta/FEEDBACK.md:12,35,65`). Census read on the `kernel/pea-first` working tree, 2026-11-06.

## Context

Agents misread the options concept three times. In F33, Fan inputs and System colours landed in a pane gear popover, not in the top-bar Settings. kaitpw's reading is that no contract says where a cell's choosable values come from, what metadata they carry, or where the cell renders.

The census shows that most of the machinery already exists. Only Work cells cannot reach it.

| Piece | Exists | Where |
|---|---|---|
| One general options op over live Revit | yes | `revit.catalog.field-options` (`dotnet/Pe.Revit.Global/Services/Host/RequestService.cs:35`) |
| A registry of 15 value domains, 9 of them live-document | yes | `SettingsValueDomainBootstrap` (`dotnet/Pe.Revit.SettingsRuntime/Json/ValueDomains/SettingsValueDomainBootstrap.cs:7-31`); `parameter-identities` at `DocumentValueDomains.cs:65` |
| A descriptor called "single source of truth for a field's options source": key, mode (suggestion or constraint), custom values, dependsOn, runtime mode | yes | `SettingsValueDomainDescriptor` (`dotnet/Pe.Shared.StorageRuntime/Capabilities/SettingsOptionMetadata.cs:22-30`), emitted as `x-options` |
| Document binding, and a `changed` mark when Revit edits the document after the read | yes | `ts/apps/host/src/resource-adapters.ts:112-150,337-345`; reading kind at `ts/packages/agent-contracts/src/reading.ts:272` |
| Which consumers use it | settings classes, op request DTOs, `/pods` and `/ops` forms, and one hand-wired cell | the cell is `ts/apps/web/src/ducts/sheet/esp-parameter.tsx:21` (the F5 dropdown) |
| A domain declaration on a Work cell | **no** | `RouteStateSpec` has only `editable` paths (`ts/packages/agent-contracts/src/route-state.ts:15-36`) |
| An option domain on a StateCell | **no** | the `choice` kind takes a hand-passed list (`ts/packages/kit/src/components/lang/cell-state.ts:189`) |
| Fill counts as option metadata | **no**, counted three times instead | C# `AirflowCandidates` (`dotnet/Pe.Revit.Global/Lib/Mep/DuctSnapshots.cs:427`), TS `slotCoverage` (`ts/packages/ducts-domain/src/kernel/terminal-flow.ts:52`), `airflow.candidates` (`ts/apps/host/src/ducts-analysis.ts:979`) |
| A render home for a cell | **no** | the top-bar menu renders only `role:"setting"` route-settings fields (`ts/apps/web/src/navigation/chrome-settings.tsx:45-90`); pane gears are hand-built (`ts/apps/web/src/ducts/proto/e/screen.tsx:426-433`) |

Other defects the census found:
- The ESP choice persists by parameter name, although the domain returns identity keys (`esp-parameter.tsx:3`, `ts/apps/web/src/ducts/sheet/mount.tsx:362-365`).
- The ESP cell ignores the `changed` mark.
- Three slots are free text where `fanStatic` is a dropdown (`mount.tsx:392-402`).
- Two pickers write `parameters.terminalFlow`: `SlotPicker` and the Protocol `ChoiceCell`.

## Considered options

Each shape faced four mock consumers:
- the F5 ESP cell;
- the flow-slot fill counts;
- the F33 Fan inputs and colours;
- Pea staging a slot through `pe_find`, `pe_read` and `pe_do`.

| Shape | What it is | What it makes impossible | Epitaph |
|---|---|---|---|
| S0. Status quo plus fixes | Keep the lists inline, add counts to `parameter-identities`, and move the F33 entries by hand | nothing | Killed. Nothing stops the fourth misreading, and Pea cannot learn which domain a cell takes. |
| S1. The proposal: a global manifest of option sources (id, owner, live flag, render home) plus one general op | A new registry beside the value-domain registry | an undeclared source | Killed as stated. The op and three of the four manifest fields already exist (id is the key, the live flag is `requiredRuntimeMode`, and so on), so a second manifest is a second registry. Render home also sits on the wrong noun. One domain (`parameter-identities`) renders in op forms, Pods and the ESP cell. Render home belongs to the cell, not to the domain. |
| S2. A value domain declared on the Work cell | A Work schema field references a domain key and its context binding. StateCell `choice` takes the domain reading, not a list. The field declares its render home. | a choice cell with no source; a domain key that does not exist, once keys are generated from the C# registry; a render home chosen per component | **Survives.** The declaration lives where Pea's Work door already projects, and the one door stays one door. |
| S3. Options inside the owner's reading | Each route reading carries its own option lists, as the flow slots do now | options and values from different document states | Killed for discovery and duplication, because each route repeats the counting. Its virtue is kept: options and the values they choose share one freshness basis. S2 keeps that by binding both readings to the document and checking at plan (S4). |
| S4. Options sealed in the plan (ADR 0030 rules 3 and 4) | The goal core returns each input's candidates with the seal | a write that picks a value Revit no longer has | Survives as a **check**, not as the source. Fetching options only through a plan makes every picker a plan Read, so interactive pickers become slow. Kept part: at seal time a constraint domain checks the staged value natively, and the plan refuses with a typed refusal. |

## Decision

ADR 0033 supersedes this ADR on reads, which run through the host read graph, and on changed Work schemas, which are discarded without migration.

S2, with the S4 check.

1. **"Value domain" is the one noun.** It means a named set of allowed or suggested values, served live by key. "Option source" and "slot" are not used for this concept. A slot stays a Revit parameter that holds a quantity.
2. **Each choosable Work cell declares its domain** in the Work schema:
   - the domain key;
   - its context binding, which the owner resolves from the subject (for example, "the current fan's units");
   - mode and custom values, inherited from the descriptor.
   The declaration emits the same `x-options` node as C#. Domain keys are generated from the C# registry, so an unknown key fails compile (ADR 0028 projection, rung 2).
3. **One door.** `field-options` serves every live domain. A static domain stays a schema `enum`.
   - Each domain chooses an optional **measure** for its items: a fill (`have` of `of`), a count, or none. For example, parameter slots show a fill, categories show an element count, and model links show none.
   - `FieldOptionItem` gains that measure and its `provenance`.
   - A `duct-parameter-slots` domain replaces the three fill counters.
4. **Script-backed domains are the escape hatch.**
   - A value domain may be served by a script (ADR 0030 rules 7 and 12) instead of a C# provider.
   - It is declared and keyed like any domain, and it comes through the same door.
   - It therefore inherits document binding, the `changed` mark and recording (ADR 0031).
   - A one-off domain needs no C# attribute, no codegen and no request-service change.
   - The C# attribute codegen and `RequestService` are open to change so that native and script domains share one descriptor.
5. **Freshness and binding.**
   - The options reading binds to the document and carries `changed`. The cell must show it.
   - The choice persists by **name** (kaitpw, 2026-11-06: "definitely NO", Occam).
   - At plan, a constraint domain checks the staged value natively. A renamed or deleted parameter then refuses with a typed refusal, and the person picks again. So a stale dropdown cannot reach Revit (ADR 0030 rule 8).
6. **Mode is configurable per declaration.** Constraint suits a fixed Revit set such as categories. Suggestion with custom values suits names that Family Foundry will create later (kaitpw, 2026-11-06).
7. **Render home and scope belong to the cell declaration.**
   - The home is **derived** from what the cell is keyed to. No field declares a home:
     - an element-keyed cell renders in the route's grid;
     - a route-wide cell renders in the active route's top-bar Settings;
     - a firm-tier cell also renders in `/settings`.
   - The scope is firm or document.
   - Cells render through the StateCell kit, with the "from /owner" label (ADR 0030 rule 9).
   - A pane gear is not a home.
8. **Pea.** Pea learns a cell's domain when it reads that Work (`pe_read`), not from every `pe_find` row (counsel's recommendation, pending kaitpw's answer). `pe_read field-options` then answers what may go there. No tool is added for each domain (ADR 0030 rule 1).

## Consequences

**What this deletes:**
- two of the three fill counters;
- `SlotPicker` or the Protocol picker, whichever loses;
- inline option lists in `ChoiceCell` callers;
- the hand-built pane gear for Fan inputs and colours.

**What it adds:**
- one field annotation on the Work schema;
- `coverage` and `provenance` on `FieldOptionItem`;
- a generated domain-key union;
- one plan check.

**The /ducts and /fans bypasses this ADR closes** (audit: `.artifacts/runs/kernel-crusade-20261104/meta/BORROWED-BODIES.md`, read at `7f5af37b`):
- **Item 1.** The ESP picker issues its own options read (`ts/apps/web/src/ducts/sheet/esp-parameter.tsx:21`). It becomes a domain cell that the kernel reads.
- **Item 2.** The slot picker and the colour input are not StateCells (`ts/apps/web/src/ducts/proto/e/slot-picker.tsx:29`, `ts/apps/web/src/ducts/proto/e/settings.tsx:53`).
- **Item 4.** The ESP picker ignores the "changed in Revit" mark (`esp-parameter.tsx:30`).
- **Item 6.** The undeclared prototype settings "Stub reach (ft)" and "Equipment hop" (`ts/apps/web/src/ducts/selection.ts:20-25`) become route-wide cells. Their derived home is the top-bar Settings.
- **Item 7.** The hand-wired gear menu, the inline kind and role lists, and the free-text slots.

Not closed here:
- **Item 8.** The two-owner edit split (`ts/apps/web/src/ducts/sheet/mount.tsx:67-85`: "a refusal cannot undo the other owner's acknowledged write") belongs to a kernel cross-owner edit under ADR 0030 rule 9.
- **Items 3 and 5**, the body-owned status text and the hand-built clear action, are kernel cleanup with no dependency on this ADR.

**Owed, outside this ADR:**
- A domain for firm-file values such as fitting tables and colours. The firm file lives on the host, and C# domains cannot read it. Either the host serves those keys behind the same Reading kind, which would be one door with two resolvers, or the values stay a schema `enum` snapshot.
- Free-text slots (`terminalDrop`, `componentDrop`, `fittingCoefficient`) become domain cells.
- ADR 0031 recording already captures these as native reads. No new input kind is needed.

## kaitpw rulings (2026-11-06)

- **Settings holds Work inputs, not only machine preferences.** "This needs to be done very thoughtfully", because a Work's scope differs even when it feels global: "it might apply to the bound doc, or to a firm standard/pod, or you might need a new one for every Work." The same cells should also show in `/settings`. Restated: the home is declared per cell, and scope is a separate, visible axis (Decision 7).
- **Mode is configurable.** "Sometimes only certain options (revit category), sometimes open ended" (Decision 6).
- **Measures are optional and easy to add.** They are not wanted on every domain. They are wrong for model links or schedules, where "a different number might fare better". "This problem space is very large and we need it very modular". The C# attribute codegen and the request service may change. Ad-hoc scripts are the escape hatch (Decisions 3 and 4).
- **No identity key on rename.** "Definitely NO. Occam." The choice persists by name, and the plan check catches a rename (Decision 5).

## kaitpw rulings after the clean-room muse (2026-11-06)

The muse is recorded in `.artifacts/runs/value-domains-muse-20261106/SYNTHESIS.md`.

- **Scopes and layering.** All six specs converged on firm and document only, over a schema default. Values replace whole, and a broken override blocks. This maps onto the existing `resolveValue` tiers (`ts/packages/agent-contracts/src/work-value.ts:7`), so there is no new engine.
- **Document settings persist in the model, through plan and apply.** kaitpw: "make sure this storage thread doesnt become another subsystem." Extensible storage that Pe chooses and builds itself is banned, because it crashes Revit when it is wrong. Extensible storage that a Revit API contract requires is allowed (see the storage amendment). The model store is therefore the existing `ProjectInfoText` pattern (`dotnet/Pe.Revit.Global/Lib/ProjectInfoText.cs:9`). Family documents and worksharing contention are still open, for a separate storage muse.
- **Firm revisions follow the live file** and show "firm changed" ("yes a, occam").
- **Placement is derived from what a cell is keyed to, never declared per field.** kaitpw: "per field is the exact lack of structure that I desperately want to make impossible."
- **Each owner gets its own model blob.** Each owner writes its own hidden `ProjectInfoText` parameter. One shared blob would make every writer borrow and rewrite the same value. kaitpw: "single owner shape is just an artifact of it never having real traffic."
- **The stored value is a name, and identity is plan evidence.** The plan seal records which parameter identity the stored name resolved to. Apply refuses when the name now resolves to none, to two or more, or to a different identity. No identity key is stored anywhere (kaitpw: "agree").
- **A Pod is not a scope.** A Pod supplies a schema default or the adopted firm standard. Three tiers cover every case: default, firm and document (kaitpw: "agree").

## Storage amendment (kaitpw, 2026-11-06)

The model-storage muse is recorded in `.artifacts/runs/model-storage-muse-20261106/SYNTHESIS.md` and `GRADES.md`. kaitpw agreed to all of the following.

1. **Projects.** Each owner has one hidden, non-user-modifiable shared Text parameter on Project Information, written through `ProjectInfoText` (`dotnet/Pe.Revit.Global/Lib/ProjectInfoText.cs`). Takeoff (`dotnet/Pe.Revit.Takeoff/TakeoffCarriers.cs:50`) and Partition (`dotnet/Pe.Revit.Partition/Declaration.cs:23`) move onto the helper.
2. **The blob envelope** is `{owner, version, data}`.
   - The reader decodes it strictly. It refuses duplicate keys and nesting past a depth bound.
   - The reader keeps unknown keys, or the write is refused.
   - The reader distinguishes an absent blob from an invalid one.
3. **Writes** use the existing plan and apply.
   - The plan seals the raw text of every owner blob that it read, and apply refuses when that text changed.
   - Apply reads the written value back exactly, and an unchanged value is a no-op.
   - A per-owner cap refuses writes over 256 KiB. The cap is provisional until it is measured on real models.
4. **Worksharing.** Revit borrows the whole Project Information element, so separate owner parameters do not give separate locks. The plan checks the element with `WorksharingUtils.GetCheckoutStatus`. It refuses and names the other user when that user owns the element, and it asks for a reload when the model is out of date with central. There is no automatic retry.
5. **Families have no document tier.** Family values come from the firm tier and the default. Family Foundry forbids hidden metadata in families (`dotnet/Pe.Shared.RevitData/Families/FamilyModelContracts.cs:74`). A family tier is added only when a route needs one, after a proof on a real family.
6. **AutoTag** stores its settings in its own `ProjectInfoText` parameter. The `DataStorage` store is deleted with no migration, so users enter AutoTag settings once more. This also removes edge case D7.
7. **Extensible storage required by the Revit API is allowed.** Pe's duct pressure-loss server keeps per-fitting results in an entity under its own schema (`dotnet/Pe.Revit.Global/Lib/Mep/PeLossServer.cs:34`). It gets a version integer inside its JSON text. The schema itself does not change, because a schema GUID cannot gain fields.
8. **One new noun:** the owner descriptor, which holds the GUID, name and version, and lives beside each owner's DTO. No registry, service or subsystem is added.

Accepted risk:
- Transfer Project Standards or Copy/Paste can overwrite or duplicate a blob. The next plan detects the change through its sealed text, but nothing repairs it.
- A hidden parameter can leak through IFC or DWG export, so owner data never holds secrets.

## Decisions still open for kaitpw

Settled since round 2:
- Layering is firm → document over the default, through the existing resolver.
- Pea learns a cell's domain when it reads that Work (kaitpw: "b").

The storage questions that were open here are settled by the storage amendment above.

Edge case D7, an interrupted migration across several homes, is removed: AutoTag is deleted rather than migrated.
