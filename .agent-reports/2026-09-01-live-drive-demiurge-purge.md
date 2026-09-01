# Live drive: demiurge / purge closeout

## Forms that held

1. **One authority per fact.** Route document identity comes from the exact Host document-session projection, not the coarse SDK session summary. The URL keeps that exact address; the route mounts only after the requested document is observed active.
2. **One lifecycle owner.** SDK `doc open`, `doc clone`, and `doc close` own Revit document lifecycle. The Host relays them and never recreates selector, year, custody, or dialog policy.
3. **One opaque native mutation per receipt.** Takeoffs carrier initialization binds one missing GUID per request. Adoption refuses until required carriers are ready; no guessed timer, retry loop, or element chunking hides a native binding call.
4. **Durable copies, not detached ambiguity.** Takeoffs clones a workshared source to a new local central, activates it, and treats the new path as the document identity. SDK beta.141 refreshes its cached open-document projection after clone activation.
5. **Authority refreshes after attempted writes.** Route invalidation runs after both successful and failed mutations so a refusal cannot leave optimistic state masquerading as truth.
6. **Repair reads; reject writes.** Snapshot projection gives legacy blank region names a stable view/element fallback. New adoption rejects blank provenance names at the backend boundary.
7. **Navigation is a handoff, not a mutation.** Choosing another Revit world changes the URL and remounts against that destination; it never writes the destination world into the departing document's persisted route state. An explicit URL target outranks legacy stored affinity on reload.
8. **Generated provenance is a release gate.** The SDK's checked-in TypeScript client must match the declared version before release planning or publication. The beta.143 release train now runs the existing deterministic client-contract check, preventing the beta.141 source/provenance split from recurring.

## Live proof

- SDK `0.1.0-beta.143` released to `eng/sdk-feed` from `150810f814b37b876bd28bc95bec204c587f63d4`; Pe.Tools pins and generated TypeScript contract moved in lockstep. The source-built release traversed the new client-contract gate before pushing all 11 packages.
- Instances POSTed its normal Host `/sessions` start contract and cold-started controlled Revit 2026 session `goal-instances-proof-r26`: PID 43784 reached bridge `ready` with build stamp `37b4e2b26d7e`. The durable SDK receipt was re-read, then the exact disposable session stopped cleanly through `pe-revit session stop`.
- R26 controlled session refused the R25 source before Revit could show the Model Upgrade dialog (`doc.revit-year-mismatch`), with the process preserved.
- R25 clone saved as `MEP_ArchitectA_ProjectA_R25_detached_20260811.PeTakeoffs.rvt`. After adoption, `doc close --intent keep` advanced the file from 321,961,984 to 322,744,320 bytes and timestamp to `2026-09-01T10:34:43.94Z`; exact reopen receipt `e4bbb1836f0845968d971d53bcccd913` succeeded.
- Current Host snapshot on the reopened file reports 71 zoning regions across Attic, Gatehouse, Lower, Main, Pool House, and Upper views; carrier status is ready with zero missing GUIDs.
- Live switching used the browser-facing control plane: `/docs/open` request `3dab9662f8a344c7a47058a4dcf15201` activated a second R25 model and its document-scoped Takeoffs snapshot reported zero zones; request `bd300495c572476f9acae3e163579b4d` reactivated the exact project-a path and the snapshot returned all 71 zones. The clean auxiliary model then closed under durable request `271e4d1dfd574378ae283c11daabb973`.
- Explicit Host target calls independently reached both `session:goal-beta138-r25` and `session:goal-beta138-r26`; R25 returned the exact project-a document while R26 returned its own empty document session. Untargeted cross-routing was not used.
- Pea black-box prompts invoked `pe_status`, `host_operation_search`, and `host_operation_call`; exact active document and open-document count were returned. The real web session client then emitted `tool_approval_required` for `script_execute` call `call_dNiL0HglfNBo6YjdisHVzDfO`, accepted denial, reached terminal `agent_end`, and left the independent canary file absent (thread `9733b7ec-cb00-4970-a745-9736b689534a`).
- The forgotten standalone `vp dev` tree on port 5173 was identity-checked and stopped; the single owned Host/web tree remained on its dynamic source port.
- Verification: web TypeScript clean; 56 focused route/document/world tests green; 18 Host session-route tests green; R25 Pe.App compile 0 errors on beta.143; Host executable package green.

## Honest boundaries

- The in-app browser proved selection, 71-region adoption, and reload persistence before the source Host changed ports. Browser automation then rejected navigation under its URL security policy, so the post-fix document/world controls and approval card are not visually certified; their route logic is deterministic-proven and their underlying live control-plane flows are session-proven.
- Pea answered 70 when asked to count a very large geometry payload; the raw Host response remained 71. A compact summary count is a useful future read primitive, but it is not required to close this route wiring.
- The full SDK deterministic suite currently fails outside this change because its prose-census test assumes the process working directory is the repository root. The focused SDK doc-route check passes.
