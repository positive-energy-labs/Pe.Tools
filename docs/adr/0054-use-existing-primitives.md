# Prefer existing primitives

Date: 2026-11-19. This extends the library rule in [ADR 0029](0029-effect-is-the-standard-library-one-fiber-per-request.md).

## Context

On 2026-11-16 the owner said, “i dont want to handroll anything at all that we can avoid, which goes for our leases among many others too.”

## Decision

Use an existing primitive when it meets the requirements at the boundary it will own. An experimental API is eligible if it meets those requirements.

## Consequences

Before writing a replacement primitive, check what the existing one actually owns and prove that it covers the difficult cases. [ADR 0050](0050-workflow-owns-durable-commands.md) records why the journal keeps durable command ownership.
