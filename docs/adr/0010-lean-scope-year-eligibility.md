# Chat scope is a document with a pin; Revit year is an eligibility filter

## Context

A chat thread must say which Revit and which document it acts on. Two Revits can hold one file, a
Revit can hold nothing, and a file opens only in the Revit year that saved it. The chimera model
(fanout 2026-09-04) gave Scope four states (`none | document | session | pinned`) and Resolution
five (`resolved | unheld | ambiguous | gone | nothing`). Driving a 12-step worldline through eight
head variants showed `pinned` over-refused once the pinned Revit moved on, `gone` named no recovery
verb, and every variant reached back into `scope.kind` to draw `resolved`. The doc-free scripting
probe (`BasicFileInfo.Extract` and friends need a Revit and no document) was raised as a reason to
keep session scope. Those reads are year-agnostic, so which Revit answers is a custody tiebreak,
not a target.

## Decision

Scope is `none | document (+ pin)`. There is no session scope. An idle Revit is reached by staging
an open into it through the instances route, and a doc-free call takes any eligible session.

The pin is a tiebreak on the session list, never a claim. It wins only while that session holds
the document; otherwise the document rules run and `via` reports what chose.

Resolution is four kinds, each naming one recovery verb: `resolved{via}`, `unheld{eligible}`
(open into the one, pin one of several, start the year when none), `ambiguous{holders}` (pick a
holder), `unchosen{sessions}` (pick a document). `gone` does not exist.

Revit year is an eligibility filter applied to the fleet before `unheld` lists `eligible`. A newer
or older Revit is never offered for a document, so an upgrade can only be an explicit human verb.
The year of a file is read from its header by the SDK with no Revit running; when unknown, every
session is eligible and the SDK's `doc open` version refusal is the backstop.

`packages/agent-contracts/src/scope.ts` is the authority. `resolveScope` is pure, total, and never
stored.

## Consequences

- The host Head store, `PUT /pe/scope/:thread`, `scope_set`, and the resolved-target headers built
  on `fanout/chimera` port onto this type; `session` and `pinned` arms are deleted, not aliased.
- The fleet the host reports must carry each session's year; the SDK doc recents rows carry each
  file's saved year.
- The instances route gains a caller: the chat head stages `open` or `start` from `unheld`.
- A user who opens a wrong-year file by hand has an upgraded document in memory; this model does
  not stop the save. Ruled ignorable for now and tracked in the agent ledger.
- Two idle Revits and no document resolve `unchosen`, never a silent pick; custody of the
  user-owned dev session is protected by refusal, not by a scope kind.
