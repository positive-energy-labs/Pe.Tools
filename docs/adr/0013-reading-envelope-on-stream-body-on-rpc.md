# 0013 — A large Reading is an envelope on the stream and a body on RPC

Date: 2026-09-24. Status: accepted. Source: design-system MAP ruling 3.

## Context

Every Reading shares one host stream, and one frame on it is capped at `READING_MAX_FRAME_BYTES` (2 MiB, `ts/packages/agent-contracts/src/reading.ts`; enforced by `ts/packages/runtime/src/resource-stream.ts` and `ts/apps/web/src/readings.ts`). The families matrix body passes that cap, so the matrix was a one-shot RPC with no taken-at and no change mark. It could not arm apply honestly and it could not say when Revit moved under it.

Two other shapes were on the table. Raise the cap: every open Reading then pays for the largest body on each republish, and a mark change resends megabytes to say one bit. Page frames: the stream then owns reassembly, ordering and partial-body states that no other Reading has.

## Decision

A Reading whose body can pass the frame cap streams an envelope and never the body. The `families-matrix` Reading frame carries the observation (taken-at), the document change mark, and `bodyVersion`, the content hash of the saved observation (`familiesMatrixEnvelopeSchema`). The body stays on disk in `TakeoffCaptures` (`observeFamiliesMatrix`). The client fetches the body over RPC (`archivedFamiliesObservation`, `GET /families/readings?id=`) only when `bodyVersion` moves.

The cap stays at 2 MiB. Frames are never paged.

## Consequences

- The matrix has the lifecycle every Reading has: taken-at, the stale mark on its read verb, and apply's freshness gate, at a frame cost that does not grow with the body. Proof: host test "the families matrix Reading streams an envelope, never the body, and wears the mark" in `ts/apps/host/tests/document-marks.test.ts` (measured 415 bytes of envelope against a 1.6 MB body).
- The body is a second fetch with its own failure. Today that failure is swallowed and the matrix keeps its last body (MAP Open); the client must surface it.
- Any other Reading that outgrows the cap takes this shape. A proposal to raise `READING_MAX_FRAME_BYTES` or to page frames is re-litigating this ADR.
