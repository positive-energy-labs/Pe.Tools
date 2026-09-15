# Design-system glossary

Canonical language for design-system and route-state decisions.

## Language

**rvt/rfa**:
A Revit model file. Reserve **document** for a generic authored or state document.
_Avoid_: document for a Revit model file

## Situation

**Situation**:
The one route-head component that says what I touch, where I am, what is staged and what I can do next.
_Avoid_: working head, targeting head, sentence (the sentence is one part of it)

**Slot**:
One operable word in the Situation sentence bound to the terminal of a ladder.
_Avoid_: picker (the picker is the popover inside a slot), binding

**Ladder**:
A dependency chain of choices, for example session › document › views. A ladder collapses to its terminal in the sentence and shows its full path inside its picker.
_Avoid_: breadcrumb (that is the picker's rendering), trunk

**Io mark**:
The `r`, `w` or `rw` superscript on a slot that says whether the route reads or writes it.

**Chain lamp**:
The one instrument reading host › session › document on every page. It reads the Revit chain only.
_Avoid_: host lamp, session lamp, instrument cluster

**Stage**:
The mode a route is in; the first word of the Situation sentence. It decides which verbs exist.
_Avoid_: step, phase, tab

**Verb**:
An action a route declares once and runs in one place. A verb has a scope; an inline button is the same verb scoped to what it sits beside.
_Avoid_: action, button

**Verb row**:
The line of verbs under the sentence, compact with counts in the buttons.

**Stack**:
The verb row expanded to one verb per line with its reason or page state at right.

**Flag**:
The popover that grows out of a pressed verb or a failing slot, carrying refused, busy or done. It shifts nothing.
_Avoid_: toast, status line, banner

**Band**:
The staged-Work layer under the verb row. The Situation owns its frame; the route fills its body.
_Avoid_: margin, panel

**Page log**:
The one event log at the bottom of a route; every route event is a row and a row opens its receipt.
_Avoid_: activity, details
