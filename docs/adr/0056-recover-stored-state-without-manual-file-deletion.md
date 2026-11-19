# Recover stored state without manual file deletion

Date: 2026-11-12. This clarifies the recovery policy in [ADR 0039](0039-two-failure-policies-by-class.md).

## Context

The owner ruled on the corrupt journal and update admission fallback in `59d4f336`. “if it a manual delete im quite opposed. its a little moot since pea can fix it, so maybe its not worth extra machinery, but its a UX smell.”

## Decision

The product handles a damaged stored file without asking the person to delete it. Preserve authored bytes and report why they could not be read. For a damaged action journal or update admission, keep the prior bytes in the blob store, set the damaged state aside, and post one notice. Refuse a retried admission when the replacement state cannot establish the original admission.

## Consequences

Recovery keeps the original bytes available and closes the path to a second write under an unknown attempt. The [host ledger](../features/host/LEDGER.md#owed) tracks open recovery work.
