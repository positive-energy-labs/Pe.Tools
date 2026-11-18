# 0052: No guard on sending outward

Date: 2026-11-17. Status: built. Source: kaitpw's ruling after field use on a coworker's 0.7.33 machine. Supersedes [ADR 0038](0038-consent-is-a-notice-three-guards-on-project-documents.md) rule 2.3 (send outward) and rule 6 (pre-allow an outward service). The other rules of ADR 0038 stand.

## Context

ADR 0038 held one act of Pea's, "send outward", for the person:
- a file's bytes to any service other than the inference provider;
- a message or share made as the person.

On 2026-11-17 a coworker used the held LlamaParse send on installed 0.7.33. Evidence is in `.artifacts/diagnostics/maddo-20261117-151039/FINDINGS.md` (D2 to D4) and in thread `2fd49f0b`. What happened:
- He needed four messages to find the Confirm.
- He confirmed twice, so the same page went to LlamaCloud twice.
- During the send, the reader still answered "The person has not been asked".
- Both step records still say `"state": "running"`.

The firm already chose the service when it put a firm LlamaParse key in `keys.json`. kaitpw: "delete guard 3 entirely. its principled but completely wrong in practice."

## Decision

1. Exactly two guards remain, and both cover project documents only:
   - synchronize with central;
   - overwrite or discard a person's model state.
2. Sending a file's bytes to a service, and a message or share made as the person, return no "held". They go out at once, and the notice feed says what was sent and where.
3. No setting pre-allows or blocks a service, because there is nothing left to pre-allow.

## Consequences

- Delete the outward hold:
  - the "held" return of `read_document` `parser: llamaparse` (`held-parse.ts`);
  - the `outward.send` Confirm row and its notice;
  - `/pe/outward/held`.
- In the one test that lists the guarded acts (ADR 0038, Consequences), the list goes from three to two.
- ADR 0038 rule 7 stands: inference sends what Pea reads to the model provider, and the written promise says so. The promise now also says that Pea sends a document to the hosted parser without asking.
- The remote MCP gateway no longer waits on a held send door (ADR 0038, Consequences).
- The duplicate send and the record stuck at `running` are not fixed by this ADR. They belong to the act lifecycle, which the 2026-11-17 field muse owns.
