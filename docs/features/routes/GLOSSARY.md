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
