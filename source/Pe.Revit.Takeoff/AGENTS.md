# Takeoffs

Takeoffs turns designer-drawn zoning intent into persistent, editable room geometry in Revit and bridges room data into Elite RHVAC for Manual J. The designer declares scope and engineering intent; ops handle deterministic partitioning, identity, and data transfer; ambiguity stays visible for human resolution.

Read [README.md](README.md) for the pipeline, data homes, and scope boundaries. Read [the takeoffs ledger](../../docs/features/takeoffs/LEDGER.md) before reopening a settled question or re-trying a falsified approach. Read [the RHVAC & Manual J reference](../../docs/features/takeoffs/rhvac-and-mj-reference.md) before touching `.r10` I/O, export conventions, or Revit↔RHVAC terminology.

## Language

- **System**: the cross-level equipment/service identity — a stable GUID paired with a mutable user tag (`FC-8`, `UH-1`, `WS-2`). Lives in the System registry; referenced by Zoning Regions; exported as an RHVAC System carrying the tag in its name. Tags are user-decided and change mid-project; joins never travel through tags.
- **Zoning Region**: persistent, designer-drawn Filled Region for one connected scope area on a level. Carries role, GUID, name, and referenced System tags via Pe shared parameters; it is both the issued sheet graphic and the detector's partition domain. Regions sharing a name read as one legend entry — "zoning group" is that shared name, not a managed entity.
- **Takeoff Room**: PE's atomic room-by-room Manual J unit. One Takeoff Room = one Room Region = one RHVAC Room.
- **Room Region**: persistent, editable Filled Region for one Takeoff Room inside a Zoning Region — the designer's edit surface. Carries role, GUID, room type, and a provenance blob (run id, source hash, `.r10` link).
- **Revit Space**: optional downstream derivation for Revit-native MEP workflows. Nothing in the takeoff critical path reads or needs one.
- **RHVAC System**: load/equipment parent in the `.r10`. Every exported room carries one explicit `SystemNumber`.
- **RHVAC Zone**: subgroup within an RHVAC System. PE leaves every room at `ZoneNumber = 1`; not a product grouping.

Unqualified Room, Zone, and System are ambiguous across Revit and RHVAC — qualify **Architectural Room**, **Revit HVAC Zone**, and **Revit MEP System** when the native entity matters. The crosswalk lives in the RHVAC reference.

## Workflow

1. The designer draws Zoning Regions and types System tags on them — declaring scope and producing the issued zoning graphic.
2. Validate/register stamps role + GUID, resolves tags against the System registry, and reports per zone; tag renames reconcile explicitly here.
3. Partition runs per zone on explicit request: first run materializes Room Regions plus held/void residue; reruns propose a diff against the accepted baseline.
4. The designer reshapes Room Regions in Revit and reruns affected zones.
5. Room data is entered in the web grid against the `.r10`; assists derive people/lighting/equipment/ventilation from room type and area.
6. Export surgically syncs the existing `.r10` — upsert by `Identifier` on geometry-owned fields, insert new rooms, park removals stale; RHVAC-native edits are never touched — and records the `.r10` linkage back onto each Room Region. Sync is copy → validate → atomic swap with a timestamped backup, and refuses while RHVAC holds the file.
7. Reconcile reports the joins and divergences across `.r10`, zones, equipment, and the FOM workbook — writing nothing.

## Laws

- **One home per datum.** Every datum has exactly one place it is changed; every other appearance is a read-through projection. The data-homes table in README.md is authoritative — a new datum gets a home there before it gets code.
- **Scope**: every Room Region belongs to exactly one Zoning Region. The detector never claims geometry outside its zone — roofs, other levels, site, linked-model noise are excluded by declaration, not inference.
- **Accounting**: accepted + held + void + excluded sums to the Zoning Region's area, exactly, per zone. Abstention stays visible; a held area beats a guessed one.
- **Editability**: a Room Region ships only through the strict promotion gate — one coherent local orthogonal frame with ordinary right-angle corners, and every straightened edge still tracing real wall evidence. Rooms that fail drop whole into visible residue, never bent to fit. Coverage or area diagnostics cannot buy back a violation.
- **Identity**: GUID (stable, machine) paired with tag or name (mutable, human) at every layer. GUIDs are minted at registration or promotion and survive reruns, splits, merges, and revisions. Out-of-sync state fails fast into explicit reconciliation — orphans block export.
- **Authority**: Zoning Regions own outer scope; Room Regions own the internal partition and are the edit surface; the `.r10` owns Manual J room data and results; RHVAC owns calculation; the FOM workbook owns equipment selection. The UI reads geometry, edits only `.r10` data and Pe metadata through ops, and never becomes authoritative.
- **Persistence**: model state lives in Pe shared parameters (bound through `SharedParameterBinder`) and versioned, fail-closed JSON-blob parameters. Extensible storage is banned.
- **Propose, never overwrite**: reruns produce diffs against the accepted state; the designer's shapes and decisions stand until explicitly replaced. Data conflicts hold and block export rather than merge silently.
- **Write-through review**: every accept/dismiss is an op that persists to the datum's home at decision time — no batch commit. Pending proposals are session-ephemeral; that is admissible only because the solver is deterministic on model + zone + constants, so a lost session costs one rerun, never a decision. Held data conflicts are the sole persisted pending state.
- **Two verbs**: accept takes the recalc's proposal; dismiss keeps the designer's state. Data-conflict holds are the only multi-choice decision. Geometry changes happen in Revit, never in web UI.
- **Drift**: accounting closure is a partition-time invariant. Hand-edit drift (gaps, sibling overlaps, out-of-zone spill) is measured against a project-constant threshold — allowed under it, blocking export over it. Reconciliation (edge snaps) is proposed by the next rerun, never applied silently.
- **Explicit triggers**: partitioning and drift handling run when a human asks, per zone — the zone is the rerun unit, and no solver threshold or constant is exposed per run. Accepted rooms are pinned by GUID re-binding, so a zone rerun cannot disturb resolved rooms. Nothing watches the model for change.
