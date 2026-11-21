# 0042: Handles, a host Timeline, and answers that say what they observed

Date: 2026-11-12. Status: accepted. Source: kaitpw's rulings on a twelve-reader review of `crusade/homes` at e02163e0, quoted in the kernel crusade 2 decision log at `8d3a507c:docs/features/routes/MAP.md` in Git.

## Context

Twelve sealed readers reviewed the tip the first kernel crusade and the homes crusade produced. All twelve signed three packages. A route still names a command three ways (a contract, hand-typed axes, a helper per transport). The browser keeps a second journal beside the host's. A native answer can claim "clear" or "rolled back" with nothing behind the claim. A stored file can be deleted on a read error. Several of the fixes change rules that earlier ADRs state, so they are recorded here once.

## Decision

1. **A route names a read or a command by a handle.** One generated table per command key holds its effect, axes and plan key. No axes are typed by hand. A verb is a handle placed in the band or one pane. [ADR 0035](0035-route-slots-subjectref-one-notice-feed.md) rule 1 stands: five slots, no new knob.
2. **The effects are `Read`, `TransactRead`, `SessionWrite`, `WorkWrite` and `ModelWrite`.** There is no `Restored` effect. The effect is the scope the runner hands an op, and the runner states `touched` on the terminal receipt. A focused capture is a `SessionWrite`; this adds one clause to the SessionWrite list in [ADR 0028](0028-seven-nouns-two-clients-one-catalog.md).
3. **The host owns the Timeline:** one read and one step door, the same for a person and for Pea, with undo answered per author on every Work. This settles the two points [ADR 0034](0034-timeline-per-work-places-on-host.md) left "not decided yet". The browser journal engine is deleted.
4. **A binding is a domain plus a home, and a setting is a home.** This supersedes the `setting` binding kind of [ADR 0037](0037-three-content-homes-one-write-door.md) rule 8 and leaves ADR 0035 rule 3 with no fourth kind. A setting's tiers are `user`, `project` and `firm`. kaitpw: "model is the same as project in principle."
5. **A finding has no `place`.** This supersedes that clause of ADR 0035 rule 9. A pointer keeps `target: SubjectRef | Place`.
6. **A native answer carries its payload, what it observed, its coverage and what it touched.** A positive spatial claim needs a predicate that can make it. Without one the answer is unknown.
7. **A declared kind mints every stored path.** A file is set aside only after its bytes are preserved, and a file that cannot be read is kept. The Work `upgrade` hook is deleted: changed Work is set aside with its bytes kept and one notice. This supersedes the single upgrade path the homes crusade added.
8. **The host imports no code from a Pod.** A Pod contributes data and routes through declared doors.
9. **Safety is structure and notices, never a pause.** kaitpw: "not approval gates that pause pea until the user notices them." This restates [ADR 0038](0038-consent-is-a-notice-three-guards-on-project-documents.md) as a rule for every later safety change.

## Consequences

- Nothing here is built. The map holds the slices, their falsifiers and the unchecked assumptions.
- Rule 2 splits the capture op in two, because an unfocused capture is a true read. If Revit's change event for a crop commit does not list the view, the owner reopens a third effect.
- Rule 5 returns only with a reader: a finding about an empty spot.
- Rule 7 means a schema change to Work costs the person their staged values, recoverable by hand from the blob. No restore verb exists.
- Rule 8 removes a Pod's only way to run code in the host at install. The way back is owed in the pods ledger.
- Rejected: a `Restored` effect (kaitpw: "i also feel like this is an occam victim"); a `ctx.with` for a second reading (a body reads it with `ctx.read`); a client-side Timeline.
