# Live drive: demiurge / purge closeout

## Forms that held

1. **One authority per fact.** Route document identity comes from the exact Host document-session projection, not the coarse SDK session summary. The URL keeps that exact address; the route mounts only after the requested document is observed active.
2. **One lifecycle owner.** SDK `doc open`, `doc clone`, and `doc close` own Revit document lifecycle. The Host relays them and never recreates selector, year, custody, or dialog policy.
3. **One opaque native mutation per receipt.** Takeoffs carrier initialization binds one missing GUID per request. Adoption refuses until required carriers are ready; no guessed timer, retry loop, or element chunking hides a native binding call.
4. **Durable copies, not detached ambiguity.** Takeoffs clones a workshared source to a new local central, activates it, and treats the new path as the document identity. SDK beta.141 refreshes its cached open-document projection after clone activation.
5. **Authority refreshes after attempted writes.** Route invalidation runs after both successful and failed mutations so a refusal cannot leave optimistic state masquerading as truth.
6. **Repair reads; reject writes.** Snapshot projection gives legacy blank region names a stable view/element fallback. New adoption rejects blank provenance names at the backend boundary.

## Live proof

- SDK `0.1.0-beta.141` released to `eng/sdk-feed` from `970d96ceeb672fc117517b32574becbfd286e8f2`; Pe.Tools pins and generated TypeScript contract moved in lockstep.
- Instances POSTed its normal Host `/sessions` start contract and cold-started controlled Revit 2026 session `goal-instances-proof-r26`: PID 43784 reached bridge `ready` with build stamp `37b4e2b26d7e`. The durable SDK receipt was re-read, then the exact disposable session stopped cleanly through `pe-revit session stop`.
- R26 controlled session refused the R25 source before Revit could show the Model Upgrade dialog (`doc.revit-year-mismatch`), with the process preserved.
- R25 clone saved as `MEP_ArchitectA_ProjectA_R25_detached_20260811.PeTakeoffs.rvt`. After adoption, `doc close --intent keep` advanced the file from 321,961,984 to 322,744,320 bytes and timestamp to `2026-09-01T10:34:43.94Z`; exact reopen receipt `e4bbb1836f0845968d971d53bcccd913` succeeded.
- Current Host snapshot on the reopened file reports 71 zoning regions across Attic, Gatehouse, Lower, Main, Pool House, and Upper views; carrier status is ready with zero missing GUIDs.
- Pea black-box prompts invoked `pe_status`, `host_operation_search`, and `host_operation_call`; exact active document and open-document count were returned. `ask` policy emitted `tool_approval_required` for `script_execute` and accepted an explicit denial without executing the script.
- Verification: web TypeScript clean; 64 focused route/state tests green; 22 Host/contract/guard tests green; R25 Pe.App compile 0 errors; Host executable package green.

## Honest boundaries

- The in-app browser proved selection, 71-region adoption, and reload persistence before the source Host changed ports. Browser automation then rejected navigation under its URL security policy, so the new-port Chat approval UI is not visually certified.
- Pea answered 70 when asked to count a very large geometry payload; the raw Host response remained 71. A compact summary count is a useful future read primitive, but it is not required to close this route wiring.
- The full SDK deterministic suite currently fails outside this change because its prose-census test assumes the process working directory is the repository root. The focused SDK doc-route check passes.
