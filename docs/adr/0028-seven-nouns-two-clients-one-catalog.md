# 0028: Seven nouns; Pea and the web are two clients of one catalog

Date: 2026-11-02. Status: accepted; items 3 (Page), 4 (Work) and 6 (Timeline) and the seal-at-preview sentence are amended by [ADR 0030](0030-pea-first-goal-core-plan-statecell.md); the `?at=` Owed is taken up by [ADR 0031](0031-recording-at-host-input-services-history-in-the-shell.md). Source: kaitpw ("agreed on all! and especially 34, cant emphasize that enough"), after the catalog muse, an adversarial review and two big-picture critics (`.artifacts/tmp/unification-2/`). Completes [ADR 0027](0027-one-route-one-subject-one-consent.md) with the technical end state of unification wave 2. Frontier and cutover: [routes MAP](../features/routes/MAP.md).

## Context

ADR 0027 fixed the behavior. The first technical shape was cut along implementation seams (write boundary, acceptance, directory, Pea catalog) and left out the author the layer exists for, a Pod: a Pod route mounts as a bare React view with its own host client (`ts/apps/web/src/routes/tool.$key.tsx:7,33-38`). It also left out the half of a write after commit, a shared outcome noun, and the value resolver ADR 0026 named.

## Decision

Seven nouns are public. Everything else is an invariant of them.

1. **Catalog entry**: an op, a host composition, a command or a route, in one linked catalog. C# `[Op]` authors Revit leaves; one TS table authors compositions and commands; Pod entries arrive at runtime through the same provider, hashed. Each entry declares a subject axis, Touches (metadata, topology, geometry), Effect (Read, TransactRead, SessionWrite, ModelWrite), cost as class times cardinality (geometry times many is refused without a cap), schemas and an example response. C# `Op.cs` owns the axis enums; typegen exports them. The linker only checks the dependency graph; `derive` and `preview` are named functions with bodies outside it. A geometry read must be narrower than a project document; a whole family document counts as bounded.
2. **Route**: an entry whose body is a manifest. It declares one subject field with a stable key kind (the codec refuses `ElementId`), stages, panes with `draws`, and verbs. A Pod route is a manifest plus bodies and mounts exactly like a builtin. The directory (home, navigation, tabs, Pea's route list, C# launch list) is generated from entries.
3. **Page**: fields with roles subject, selection, setting and pose; one owner; URL and tab memory are projections with an explicit restore order.
4. **Work**: one journal and revision per Work; Pea's edits are undo steps; one typed value resolver (run input, Work, model store, firm, engine default) returns value, units, source, version and missing state. Revit owns observed facts. One identity/epoch/revision gate accepts acks and stream frames.
5. **Reading**: a demand on an entry, with retention by kind and content-hashed published values; pane heads show status and refresh. One reading engine.
6. **Timeline**: append-only invocations with one id across the journal, native execution and receipt; typed outcomes (queued, running, refused, stale, cancelled, succeeded, failed, outcome-unknown) with reason, retry or reconcile action and preserved input; open consent windows; receipts with before-values; snapshots `{address, work revision, reading hashes}`. ActionJournal is the execution owner. A command rechecks its preconditions when it runs, reconciles an unknown outcome before retry, and retires only receipt-confirmed cells.
7. **Pod**: an author of entries and routes under one versioned registration contract (namespaced keys, schemas, module hash, migrations). Deactivation removes availability, never receipts or Work.

Write boundary rulings: every Work command derives its input from Work (`workIntent`), and only ModelWrite is sealed at preview (`workWriteCommands`; the registry and `command-axes.ts` refuse a boundary on any other axis); raw model-write leaves are `Internal` and the bridge refuses them. SessionWrite (cancel, show elements, lens, open family) is exempt and runs under run consent. TransactRead declares its rollback, and the bridge enforces it. Scripts are ModelWrites unless ReadOnly; they are the escape hatch, under run consent, with their footprint in the receipt. `pod.member.compose` is a file write under consent. This amends ADR 0027 rule 10 for SessionWrite and scripts.

Engine: `ducts-domain` runs on the host as a composition entry; a browser worker runs the same entry only where marked local-ok. C# pricing is deleted. Pea's catalog is the generated catalog plus a live availability overlay and one named provider for packages, skills, pages, route docs and route views. `electrical-circuits` and `ducts.snapshot` split into roster and walk entries.

Route splits (ADR 0027 rule 1): `/ducts` and `/fans`; `/open` and session administration; takeoff into view adoption, zone audit and RHVAC file sync; Pods member authoring and Pod administration; schedules inspection and definition authoring. `/space` takes a region as its subject.

## Consequences

- Rejected: generating UI or domain logic from the catalog (schemas carry no subject meaning or geometry trust); one mutable universal route object; Pea and the web as literally one client (Pea has no camera or hover; it uses the lease).
- The `?at=` snapshot feature stays Owed; its groundwork (content-hashed readings, Timeline references) is in this wave. ADR 0031 owns its shape and step order.
- The cutover order, ratchets and proof bar are in the routes MAP; ADR 0027 rule 15 governs process.
