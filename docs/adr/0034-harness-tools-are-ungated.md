# 0034: The harness's own tools are ungated

Date: 2026-11-10. Status: accepted. Source: kaitpw, 2026-11-10, "Pea's harness shell should never have been blocked. The reason for moving Pea onto lab harnesses (Claude Code, Codex) was their shell setups, and capability is not gated by default." Supersedes the last clause of [ADR 0027](0027-one-route-one-subject-one-consent.md) rule 11 ("native writes outside the journal stay refused") and the sentence "Unjournaled native mutation approvals refuse" in [ADR 0024](0024-root-run-consent-and-shared-work.md). The harness access switch of [ADR 0021](0021-one-access-switch-and-document-targets.md) stays deleted.

## Context

`requestPermission` in `ts/apps/host/src/harness/threads.ts` allowed only Pea's own MCP tools and the ACP kinds read, search, fetch and think. Every other kind, including the shell (`execute`), was rejected with no card. The host also forced session mode `default` (Claude) or `read-only` (Codex), so even a permitted shell ran in a sandbox that blocked it.

Claude Code tells the model "User refused permission to run tool" on a reject. In thread 870657c5 Pea told the user "since you declined that" and dropped the work it was reading on the user's G: drive. The user declined nothing. The refusal path made Pea less capable than the harnesses it was moved onto for their shell.

## Decision

1. The harness's native tools (shell, file reads and edits, fetch) are ungated. The host answers every per-call approval with allow and shows no card.
2. The host picks the harness's ungated mode: `bypassPermissions` for Claude (`default` when the adapter withholds bypass, because the host allows every ask in that mode), `agent-full-access` for Codex. A harness that offers none of them fails to start, loudly.
3. No toggle. The refusal path, its failed-card text and `isPeaTool` are deleted.
4. Unchanged: Revit and product state change only through Pea's host commands (`pe_do`, run consent per ADR 0027, the ActionJournal). The harness shell has no Revit door and the journal does not see native file changes. Receipts, Stop and Reject cover host commands only.

## Consequences

- Pea can run a shell, read any drive and run scripts with no approval step. A user's Reject or Stop does not stop a native shell command that already started. The Pea kernel still tells Pea to confirm the exact file target before editing a user file.
- The open S3 proof "real-provider native file/shell confinement" in `docs/features/agent/LEDGER.md` is void: there is no confinement to prove.
- Adapter modes remain not a sandbox (ADR 0024), now by decision instead of by gap.
