# 0008 — Session custody and the test rungs replace contact and the sandbox lane

Date: 2026-08-20. Status: accepted. Supersedes [ADR 0002](0002-sandbox-shares-installed-host.md)
and [ADR 0007](0007-proof-lane-and-contact-taxonomy.md).

## Context

ADR 0007 fixed a real problem — three inconsistent lane lists — with a taxonomy built on the SDK
surface of the time: a `sandbox` lane, a `live` command family, `AttachedRrd`/`NoRrdContact`
MSBuild tokens, and a **contact** axis that Pe.Tools invented because the SDK disclosed no
ownership fact of its own. ADR 0002 then ruled how a `lane=sandbox` descriptor maps to
`ProductRuntimeLane`.

Pe.Revit.Sdk `0.1.0-beta.121` retired all of it in one release with zero aliases. The SDK now
discloses ownership itself, so a Pe.Tools-side coordinate that reasons about it is a second,
weaker copy of a fact the resolver already enforces. Both ADRs describe machinery that no longer
exists.

## Decision

Pe.Tools adopts the SDK vocabulary verbatim. Terms are defined once, in the SDK — `pe-revit guide
session`, `SPEC.md`, and the SDK's own ADR 0002 — and this repo never re-defines them.

**Custody replaces contact.** A session is `controlled` (pe-revit holds its registry receipt: full
lifecycle and document operations) or `observed` (no receipt: status and document reads only). The
SDK resolver refuses a disallowed mutation before the verb runs, so Pe.Tools code and prose read
custody and never guard it a second time. `origin` (`cli`, `mcp`, `test`, `pea`, `web`) is
attribution and gates nothing. The values `none`/`owned`/`dev`, and `owner: agent|user`, die.

**Lane means payload source only:** `dev` (byte copy of a checkout's interactive build, from
`--project`) or `installed`. There is no `sandbox` lane, so ADR 0002's mapping question is
dissolved rather than answered — a controlled session on the `installed` lane *is* the installed
payload, and the host it talks to follows from that lane, not from a second attribution.

**Proof lanes keep the plain words, minus the retired ones.** `deterministic`, `compile`,
`artifact`, `fresh`, `attached`, `session`, `installed`. `sandbox` is gone; `live` is not a lane, a
verb, or an evidence label. `deterministic`, `fresh`, and `attached` are also the three **rungs** of
`pe-revit test`, which the verb chooses from the project and discloses — never sub-verbs a caller
types, and never derived from what is installed on the machine.

The `Rrd` spellings are gone from this repo with `build/ExecutionPolicy.cs`; the SDK's MSBuild
tokens have been the plain words since beta.117. There is no mapping table left to keep.

## Consequences

- `AGENTS.md` Proof Lanes and `docs/BUILD.md` speak this vocabulary and point at
  `pe-revit guide <topic>` for mechanics instead of restating them. A repo doc that explains an SDK
  flag has become a cache that rots.
- Evidence claims name lane plus custody ("fresh rung", "attached in a controlled dev-lane
  session"), never "live-proven" and never a contact value.
- Pe.Tools wraps SDK capability. The vendored `pe-revit-contract.ts` is the one consumer contract;
  a hand-maintained selector grammar, argv builder, or custody guard beside it is drift by
  construction.
- Dated historical evidence labels in ledgers and grounding docs are not rewritten. This ADR
  governs new claims.
