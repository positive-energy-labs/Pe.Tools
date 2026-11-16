# 0048: C# contracts generate Effect Schema

Date: 2026-11-16. Status: accepted target, runtime UNPROVEN. Source: accepted [Converge S3](../features/host/CONVERGE-MAP.md#ordered-deletable-slices). Amends [ADR 0029](0029-effect-is-the-standard-library-one-fiber-per-request.md) rules 7 and 8's operation-schema transition. Builds on [ADR 0046](0046-effect-identity-belongs-to-the-effect-owner.md).

## Context

C# DTOs and operation metadata own native meaning, but generated zod and host adapters duplicate the contract. Discovery found a date-time validation gap, accepted int32 overflow and a recorded response that no longer decodes. Performance gauges do not establish contract parity.

## Decision

1. Generate native operation Effect Schema from C# DTO JSON Schema and operation metadata. The generated catalog remains public contract authority; a connected host answers availability only. TypeScript types and decoders derive from that source, never parallel handwritten native schemas. Host-only contracts use Effect Schema at their owning service.
2. Generation preserves request/response direction, requiredness, defaults, nullability, date-time validity, int32 limits and exact numeric identity. Refuse unsafe integer ids at decode; carry larger ids as strings only after a C# contract change (OD3). Never widen a refusal to make a fixture pass. Preserve one-way encoding restrictions in compiler checks.
3. Move the Pod read door to Effect Schema. Runtime inputs and recordings decode with the same generated schemas. Re-record or re-decode every native fixture; a mismatch refuses with provenance, never falls through to live input. ADR 0031's swappable source and ADR 0033's publication rules stand.
4. Unconverted consumers keep zod behind one named temporary `fromStandardSchema` boundary. Its import count only shrinks; S5 removes zod per converted family and S6 deletes the boundary. No compatibility shim becomes a second contract owner.

## Consequences

The operation model in ARCHITECTURE is generated Effect Schema. Authored settings still use their JSON Schema validation path; this decision does not replace that separate contract.

S3 must run the E0 refusal corpus, compile the forbidden encoding case, decode every recording and check generator drift. The schema-performance report is inherited gauge evidence only. No generator, Pod door or runtime decoder changes land in S0; parity remains UNPROVEN.
