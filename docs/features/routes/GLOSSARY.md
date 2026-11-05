# Routes glossary

Canonical language for web routes and their kernel (ADR 0026, ADR 0027).

## Language

**rvt/rfa**:
A Revit model file. Reserve **document** for a generic authored or state document.
_Avoid_: document for a Revit model file

## Shape

**Route**:
One question about one kind of subject. A change of subject noun is a new route.
_Avoid_: tool, plugin, page

**Subject**:
The kind of thing a route is about, declared once per route with its noun and cardinality (`one` or `many`).
_Avoid_: target (that is the document), scope, selection

**Roster**:
The geometry-free list of every subject a route can pick. The roster pane is the subject picker.
_Avoid_: index, catalog

**Stage**:
A mode or walk over the same subject. A person can always pick it.
_Avoid_: step, phase, tab, view (a view is a look-variant)

**Graph**:
The one typed declaration of a route (`RouteGraph`): subject, stages, verbs, readings, layout and keys. The kernel executes it. ADR 0026 calls it the manifest; "the manifest is the graph".
_Avoid_: spec, route store

## Head

**Situation**:
The route head: the document plus the verbs.
_Avoid_: working head, targeting head

**Ladder**:
A dependency chain of choices, for example session › document. It collapses to its terminal and shows its full path inside its picker.
_Avoid_: breadcrumb (that is the picker's rendering), trunk

**Verb**:
An action a route declares once and runs in one place. A verb has a scope; an inline button is the same verb scoped to what it sits beside.
_Avoid_: action, button

**Verb row**:
The line of verbs in the Situation, compact with counts in the buttons. Expanded, it is a stack with one verb per line and its reason.

**Flag**:
The popover that grows out of a pressed verb or a failing slot, carrying refused, busy or done. It shifts nothing.
_Avoid_: toast, status line, banner

**Band**:
The staged-Work layer under the verb row. The Situation owns its frame; the route fills its body.
_Avoid_: margin, panel

**Page log**:
The one event log at the bottom of a route; every route event is a row and a row opens its receipt.
_Avoid_: activity, details

## Core and writes (ADR 0030)

**Goal**:
The output of a route's core: the unresolved closers, the assumed closers, `next`, the inputs as StateCells, and a result that is complete or a greyed estimate with sources. Pea and the UI read the same Goal.
_Avoid_: readiness, assessment, obligations

**Closer**:
One unresolved item in a Goal, with its kind and its resolver (person, Pea or op).
_Avoid_: blocker (the old sheet word), todo

**StateCell**:
The one drawing of a value Pea can touch: current value, model value struck, pending author, drift, freshness, source. Pea stages into it; last writer wins; undo restores.
_Avoid_: suggestion, proposal, input (for the drawing)

**Plan**:
A Read with an empty footprint that derives a write's request from Work and returns its seal. Every ModelWrite binds one.
_Avoid_: preview (that is a rehearsal), dry run

**Rehearse**:
An optional TransactRead that runs the write inside Revit and rolls back. It alone earns "checked in Revit". It refuses when it would borrow elements.
_Avoid_: preview with no transaction, validate

**Seal**:
What a plan returns and apply rechecks: request hash, consumed Work handles and revisions, document mark, dependency hash.
_Avoid_: ticket, token

**Pointer**:
An entry in the shell's per-thread "Pea is pointing at" list. It highlights and never selects or moves the camera; it stays until dismissed.
_Avoid_: annotation, claim

**Attention**:
What Pea knows of a person's open work, published as a read projection by routes that declare an agent block. Not a lease.
_Avoid_: lease, control

## Recording (ADR 0031)

**Taking**:
One consumed input recorded at the host's input services: content hash, time, coverage and an outcome kind (answered, refused, unknown). Repeated identical reads are distinct takings.
_Avoid_: observation (that is the stored bytes), sample

**Epoch**:
A named point per document (after write, synced, captured) over a range of takings and the bindings that say what each pane showed.
_Avoid_: snapshot (ADR 0028's reference triple), frame, version

**Recording**:
A bundle of takings and observations that answers the host's input services in place of Revit. Users read it; only a developer build edits on it; a plan runs and rehearse and apply refuse.
_Avoid_: fixture (hand-authored seeds), cassette, replay (the act)

**History rail**:
The shell's list of named points for the open document. A route writes nothing for it.
_Avoid_: history pane (per route), timeline (the projection it derives from)
