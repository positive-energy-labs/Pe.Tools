# ADR Format

The template only. Where ADRs live, how they are numbered, when one is warranted, and how reversals work are owned **per the `docs` skill** — read it first.

## Template

```md
# {Short title of the decision}

## Context

{What forced the decision — the constraint, the trade-off, the alternatives on the table.}

## Decision

{What was decided, stated in the present tense.}

## Consequences

{What this now costs or enables downstream — including the non-obvious effects.}
```

One page max. A short ADR is a good ADR: the value is in recording *that* a decision was made and *why*, not in filling out sections. Where a section has nothing real to say, one line is enough — but don't drop the headings, they are what makes ADRs skimmable as a set.

## Optional additions

Only when they add genuine value. Most ADRs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited.
- **Considered options** — only when the rejected alternatives are worth remembering.

## What tends to qualify

Examples of decisions that clear the `docs` skill's bar, as a calibration aid:

- **Architectural shape.** "The write model is event-sourced, the read model is projected."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target — not every library, just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "Manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite — these stop the next engineer from "fixing" something deliberate.
- **Constraints not visible in the code.** Compliance limits, partner-contract response times.
- **Rejected alternatives when the rejection is non-obvious.** Picked REST over GraphQL for subtle reasons — record it, or someone re-suggests GraphQL in six months.
