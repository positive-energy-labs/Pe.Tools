# Agent glossary

Terms for how a chat thread targets Revit and how Pea learns what it can do. Code identifiers are
verbatim; `packages/agent-contracts/src/scope.ts` and `capability.ts` are the authority.

## Targeting

**Scope**:
What the user chose for a chat thread. One of two states: `none`, or `document` with an optional
`pin`. `scopeSchema` in `scope.ts`. A Scope never holds a derived value and never names a session
on its own.
_Avoid_: Target, world, binding, selector, turn scope, session scope.

**Head**:
The one record the host keeps per chat thread: a Scope plus its revision. The chip row at the top
of the chat renders it and is its only human writer. `headSchema`.
_Avoid_: Scope row, thread scope, ScopeRevision.

**Revision**:
The counter on a Head. Every write carries `expectedRevision`; a write that read an older revision
is refused as `stale` and returns the current Head. Not a history.
_Avoid_: Version, etag.

**Turn**:
Everything between a user message being admitted and Pea's final answer, including every tool
call and approval. A turn copies the Head at admission and keeps it until it ends.
_Avoid_: Run, block, message, step.

**Pin**:
The session id on a `document` Scope that breaks a tie when two sessions hold the document. It
counts only while that session is a holder; otherwise the document rules run. It is not a scope.
_Avoid_: Pinned scope, explicit session, forced target, claim.

**Resolution**:
What the fleet says about a Scope right now, computed on every call and never stored.
`resolveScope` in `scope.ts` returns `resolved`, `unheld`, `ambiguous`, or `unchosen`. Each kind
names one recovery verb.
_Avoid_: Resolved scope, head state, target resolution, gone, nothing.

**Via**:
The field on `resolved` that says what chose the session: `only` (one Revit running), `holder`
(the one session holding the document), or `pin` (the user's tiebreak).
_Avoid_: Derived, defaulted, chosen.

**Unheld**:
The Resolution when the chosen document is open in no connected session. It carries `eligible`,
the sessions of the document's year: open into the one, pin one of several, start the year when
none.
_Avoid_: Dangling, absent, no-match.

**Ambiguous**:
The Resolution when two or more sessions hold the chosen document. The head offers each holder;
pressing one pins it.
_Avoid_: Conflict, collision.

**Unchosen**:
The Resolution when nothing is chosen and the fleet has zero or several sessions. The user picks a
document. Two idle Revits never resolve by a silent pick.
_Avoid_: Nothing, empty, gone.

**Eligible**:
A session whose Revit year equals the document's saved year. A file opens only in its own year;
an upgrade is an explicit human verb, never a resolution.
_Avoid_: Compatible, matching.

**File year**:
The Revit year that saved a `.rvt` or `.rfa`, read from the file header by the SDK with no Revit
running. Null when unreadable; then every session is eligible and `doc open` is the backstop.
_Avoid_: Format, document version.

**Resolved target**:
The session and document a call actually ran against, as the host reports them in the
`x-pe-resolved-session` and `x-pe-resolved-document` headers. Every `pe_do` and `pe_read` result
carries one, so a tool card shows what was touched, not what was typed. `resolvedTargetSchema`.
_Avoid_: Target, before/after stamp.

**Fleet**:
The set of connected Revit sessions and the document each has active, as the host reports it.
`FleetSession` is the shape `resolveScope` reads; each session carries its Revit year.
_Avoid_: World, topology, bridge sessions.

**Custody**:
A fact about a session: `controlled` when the SDK launched it and holds its receipt, `observed`
when it is the user's own Revit. Custody is read from the fleet; it is never a selector.
_Avoid_: Lane, mode.

## Capability

**Capability**:
One thing Pea can do, as one entry in the one catalog: an op, a route document, a route command, a
pod button, or a skill. Every entry carries `needs`, `mutates`, `actor`, and an input schema.
`capabilitySchema` in `capability.ts`.
_Avoid_: Tool, door, operation (when the entry is not an `op:` row), tier.

**Catalog**:
The list of every Capability, assembled at request time from the sources that own them and served
by `GET /pe/capabilities`. A source that cannot answer is named in `sources`; nothing is hidden.
_Avoid_: Manifest, map (the map is the compressed view of the catalog).

**Door**:
A Pea tool that reaches the catalog: `pe_find` ranks it, `pe_read` runs an entry with
`mutates: false`, `pe_do` runs any entry and is approval gated. No door takes a target input.
_Avoid_: Verb, endpoint.

**Actor**:
Who may run a Capability. `any` includes Pea; `human` refuses Pea with a hint to ask the user.
Lifecycle verbs `restart`, `stop`, and `close` are `human`.
_Avoid_: Permission, role.
