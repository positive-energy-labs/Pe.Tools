# Runtime acceptance record — 2026-07-12/13

This is the durable execution record for `Pe.Revit.Sdk/RUNTIME_ACCEPTANCE.md` with Pe.Tools as the consumer and receiver of fixes. Raw machine evidence was captured under:

```text
C:\Users\kaitp\AppData\Local\Temp\pe-runtime-acceptance\preflight-20260712
```

**Overall verdict: pass for the local runtime-acceptance candidate.** Gates 0-9, the Pe.Tools
consumer regressions, RRD/sandbox/test/worktree coexistence, and the browser-visible Pea sandbox
interaction all passed. The final Gate 1 retry loaded SDK `0.1.0-beta.66`, applied and rolled back a
method-body edit through Rider Hot Reload while preserving Revit PID 42816, opened the disposable
family through an explicitly selected raw `/call`, and posted the real Pe Tools ribbon command. The
visible dialog showed the hot-reloaded probe, the intended document, and the same PID.

## Candidate authority

| Authority | Candidate |
| --- | --- |
| SDK repository | `C:\Users\kaitp\source\repos\Pe.Revit.Sdk` |
| SDK commit | `3a8c0e74a09766d5f9352ccfe48c9e8d943ff5f9` |
| SDK package/CLI | `0.1.0-beta.66` |
| Consumer repository | `C:\Users\kaitp\source\repos\Pe.Tools` |
| Consumer commit at final packaging start | `f970088315d470d8ef5a49d3cc05088253f488ff` plus the recorded dirty acceptance fixes |
| Revit/configuration | Revit 2025 / `Debug.R25` and `Release.R25` |
| Installed product | Pe.Tools `0.6.9` |

The Pe.Tools worktree was intentionally dirty and shared with other work. `consumer-status.txt` is the boundary snapshot; acceptance edits were kept narrow and unrelated changes were not reset or staged.

## Gate verdicts

| Gate | Verdict | Durable result and principal raw evidence |
| --- | --- | --- |
| 0. Artifact authority | Pass | SDK beta.66 was packed/released to the local feed, pinned in both `global.json` and `.config/dotnet-tools.json`, and resolved by the consumer. See `00-sdk-pack-beta62-rerun.json`, `00-sdk-local-release-beta63.json`, `00-doctor.json`, and the final install receipts. |
| 1. RRD/live | Pass | Earlier no-change, Hot Reload, and rude-edit restart paths passed. The final authorized retry started candidate PID 42816 from the exact Pe.Tools descriptor. Rider bridge `0.4.3-pe-revit-sdk` applied `[HR-PROBE-POST-REBOOT]` and its rollback with `RiderDebuggerApplyEncChagnes=Applied`, `restartRecommended=false`, and the same PID. Explicit-selector raw calls opened `source-sandbox-artifact.rfa`, discovered `General:Pe Tools`, and posted its exact command ID. The visible TaskDialog showed `Pe Tools Bridge: Connected`, PID 42816, the opened document, and the probe footer. See `30-post-reboot-session-summary.json` through `37-post-reboot-hot-reload-rollback.json`. |
| 2. Attached test | Pass | AttachedRrd planning and execution resolved the same RRD PID with no second Revit. See `02-attached-plan-3.json`, `02-attached-3.json`, and `02-attached-pids-3.json`. |
| 3. Fresh test beside RRD | Pass | A test-owned process ran beside PID 57852 and closed; a concurrent contender returned busy without touching RRD or global add-ins. See `03-fresh.json`, `03-fresh-concurrency.json`, `03-rrd-after-fresh.json`, and `fresh-race-*.txt`. |
| 4. Source sandbox | Pass | Source sandbox used an immutable generation, explicit `sandbox:source-e2e` routing, read/mutation, explicit `Document.SaveAs`, artifact reopen, restart, and failed-build preservation. See the `04-*` evidence and `source-sandbox-artifact.rfa`. |
| 5. Installed sandbox | Pass | Installed sandbox resolved beneath the receipt-backed installed version from a neutral directory. The final Pe.Tools 0.6.9 installer was rebuilt after all tooling fixes, force-applied, and verified from `%TEMP%`; installed Pea created, targeted, used, and stopped a sandbox from its chat route. See `17-final-install-apply-after-tooling-fixes.json`, `17-final-install-verify-checkout-free.json`, `18-final-installed-sandbox-start.json`, `06-pea-live-installed-final2.json`, and `20-final-installed-pea-live.json`. |
| 5A. Service primitive | Pass | One atomic host service incarnation was reused by concurrent callers; installed/dev takeovers replaced it without duplicates; SDK safety harness covered PID/start/executable mismatch and timeout cleanup. Raw RRD and sandbox session IDs reconnected stably. See `05a-concurrent-idempotence-verdict4.json`, `05a-*-takeover-*.json`, `11-reconnect-*.json`, and `14-sdk-loader-harness-final2.txt`. |
| 6. Routing/API parity | Pass | Raw `/call`, Pea/MCP, web client, operation, scripting, capture, and lifecycle surfaces preserve an explicit selector or reject ambiguity. Raw session ID routed exactly; stale selector returned not-found. A fresh installed SDK MCP client listed 28 tools and exercised start/status/restart/wait/stop. See `09-routing-selectors.json`, `06-sdk-mcp-installed-lifecycle.json`, source/installed Pea transcripts, and focused TS tests. |
| 7. Worktree coexistence | Pass | Worktree-A RRD + worktree-B sandbox and A-sandbox + B-sandbox used distinct PIDs, descriptors, generation roots, journals, and sentinel documents. Restart/stop remained lane-local and attached tests hit only A. See `07-*` and `07-sentinel-isolation-complete.json`. |
| 8. Close/ownership safety | Pass | Local dirty artifacts closed through ordinary no-save stop with stable hashes. The final installed no-save proof recorded the exact close event sequence and unchanged protected hash in `19-final-close-proof.json`. A clean central model was created, opened with `DetachAndPreserveWorksets`, mutated unsynchronized, and stopped without UI. Central SHA-256 remained `B801209D5CA07D0C649728F6B2DA8F1FF49BD1DEB9167796916FA787B091E2BF`; journal contained `NoSaveArmed`/`NoSaveDialog` and zero sync/relinquish events. See `08-workshared-*.json`, especially `08-workshared-verdict2.json`. Mutation racing produced one owner and deterministic `sandbox.mutation-busy`; bridge-disabled recovery killed only the reverified owned sandbox. |
| 9. Cleanup | Pass | All acceptance-owned sandboxes used ordinary stop unless a failure had already invalidated the happy-path evidence. Post-reboot `09-sandbox-final-post-reboot.json`, `09-live-final-post-reboot.json`, and `09-revit-processes-post-reboot.json` show every sandbox stopped and exactly the final user RRD PID 42816, fresh at the expected source payload with the disposable family still open. |

## Live Pea chat-route proof

Two black-box chat interactions proved the requested end state rather than only testing MCP declarations:

- Source Pea thread `08439393-80d1-4334-a99b-bf1989da39fc` created sandbox `pea-live-e2e` (PID 73916), explicitly targeted `sandbox:pea-live-e2e`, opened the saved family artifact, read `Acceptance_Source_E2E`, and stopped the sandbox.
- Installed Pea thread `2f941875-5812-49c3-8ee4-9dd5f3a9bcf9` created installed sandbox `pea-installed-e2e` (PID 46376), performed the same explicit-selector document/script proof, and stopped it.

The installed transcript is in `06-pea-live-installed-final2.json`; the source transcript is in `06-pea-live-source.json`.

A final browser-visible installed proof ran on the actual `/chat` route in thread
`aae089b0-604e-43b9-9239-ac133dd3e1f5`. Pea started `pea-browser-final-doc` (PID 57192), preserved
the exact selector `sandbox:pea-browser-final-doc` for every Revit-backed call, opened
`source-sandbox-artifact.rfa`, returned `revit.context.summary`, executed a ReadOnly script that
reported `PID=57192`, `doc.Title=source-sandbox-artifact`, and `doc.IsFamilyDocument=True`, captured
the active sheet view, then used ordinary lifecycle stop and verified `state=stopped`. The completed
thread was left open as the operator-visible acceptance artifact. This retry did not build,
converge, restart, or target the user RRD session.

The completed 29-message browser thread was subsequently exported through the same host's native
agent-controller read route as `40-browser-chat-thread-export.json`. The export contains the exact
`sandbox:pea-browser-final-doc` selector, PID 57192, document-open result, context, ReadOnly script
result, capture operation, and ordinary stopped state. `41-final-runtime-acceptance-verdict.json`
machine-checks those facts together with the post-reboot RRD witness, final regression logs, and
zero-running-sandbox cleanup state.

## Final RRD Hot Reload and ribbon witness

After the machine restart, `pe-revit live` explicitly converged the Pe.Tools RRD candidate and
created PID 42816. The source host came up as `lane=dev` from
`C:\Users\kaitp\source\repos\Pe.Tools\source\pe-tools`; the connected Revit session registered as
`session-e456dd7a5eb63e87` and reported the exact RRD payload and SDK beta.66 bridge/loader.

The final witness then:

1. changed only the `CmdPeTools` footer to `[HR-PROBE-POST-REBOOT]`;
2. used authenticated Rider bridge `0.4.3-pe-revit-sdk` to apply the edit, with VFS refresh,
   four scoped document reloads, `Applied`, and no restart recommendation;
3. sent every raw `/call` with
   `x-pe-bridge-session-id: session-e456dd7a5eb63e87`;
4. opened `source-sandbox-artifact.rfa`, searched for `CmdPeTools`, and posted the exact returned
   `CustomCtrl_%...%Pe.App.Commands.PeTools.CmdPeTools` command ID;
5. visibly observed `Pe Tools Bridge: Connected`, `Process: 42816`, the active disposable family,
   and the probe footer in Revit; and
6. dismissed the modal, restored the source footer, and Hot Reloaded the rollback with `Applied`
   while preserving PID 42816. `git diff` for `CmdPeTools.cs` was empty afterward.

The raw evidence is `30-post-reboot-session-summary.json` through
`37-post-reboot-hot-reload-rollback.json`. This also proves that the existing
`revit.apply.command.execute` host operation is sufficient for automation; Computer control was
needed only to capture and dismiss the modal visual witness.

## Fixes made during acceptance

### Pe.Revit.Sdk

- `beta.62`: stopped treating Rider `NoChanges` as proof that a changed runtime was fresh.
- `beta.63`: armed bounded no-save handling before sandbox close/restart and mapped Revit's dirty-file dialog to Don't Save.
- `beta.64`: made the installed CLI/product context independent of a checkout or caller CWD.
- `beta.65`: signed the stable loader/shim artifacts so disposable Revit startups do not block on an unsigned-add-in approval prompt.
- `beta.66`: preserved installed payload origin/version through sandbox descriptors and consumer runtime context.
- Added the service primitive contract to `RUNTIME_ACCEPTANCE.md` and extended loader/sandbox harness coverage for identity, receipts, mismatch refusal, and process-tree cleanup.
- Rider bridge `0.4.3-pe-revit-sdk`: replaced the synthetic leading-character insert/delete used
  to notify Roslyn with a complete clean-document reload. The synthetic intermediate snapshot could
  reach Roslyn's EnC trivia mapper and produce `ENC0080`/`ArgumentOutOfRangeException`; unsaved editor
  documents are deliberately skipped so the reload cannot discard user text.

### Pe.Tools

- The dev host resolves the SDK CLI from its own checkout and rejects empty, invalid, or non-envelope output. It never silently falls back to an installed shim; installed host resolution remains installed-only.
- Raw `/call`, web, Pea operation/search/scripting/capture calls, and lifecycle proxying carry the explicit `x-pe-bridge-session-id` selector.
- Script execution is a single targeted host call. It no longer builds, converges, or restarts a session as a hidden precondition; freshness inspection and lifecycle mutation are explicit agent choices.
- Pea gained checkout-independent installed workspace handling and uses the SDK service primitive for lane-aware host discovery/takeover.
- Pe.App became a client of the one shared product host. It accepts an already-healthy host incarnation instead of continuously forcing dev/installed lane takeovers.
- Clean dev launches can start the checkout-pinned source host without first staging `Pe.Host.exe`; this is launch-only and does not build or converge Revit.
- Shared product logs serialize same-version writers with a path-derived cross-process mutex and use
  a native best-effort open compatible with older installed writers. Contention drops a log entry
  instead of surfacing a first-chance managed `IOException` through a Revit callback; the mixed-version
  regression test asserts zero path-specific first-chance `IOException`s and successful append after
  the old writer releases the file.
- Build discovery skips nested repositories/worktrees so unrelated agent checkouts do not become Pe.Tools projects.

## Non-obvious constraints and decisions

1. One product root plus one service name identifies one host incarnation. Installed and dev callers may explicitly take it over, but both lanes cannot continuously supervise different hosts at the same root. Simultaneous same-name hosts require different product roots or service names.
2. Host selection and Revit-session selection are separate. The SDK service primitive owns IPC process discovery/supervision; every consumer request still needs an explicit Revit session selector.
3. Pe.App does not own host lane convergence. A Revit add-in starting or reconnecting is not permission to replace a healthy host. Explicit Pea/install/service lifecycle actions own takeover.
4. Script freshness is observable state, not an implicit side effect. Agents inspect status and request `live`/`restart` explicitly when freshness is insufficient.
5. Dual-RRD Hot Reload is intentionally not supported. The supported same-year coexistence shapes are RRD+sandbox and sandbox+sandbox.
6. `spike/prove-coexistence.ps1` can report a dev-leg failure when an RRD holds its own dev outputs. That is not cross-lane write-path collision; the script currently conflates self-owned RRD locks with shared-output overlap and should not be used as the only verdict.
7. Prefer the pinned `pe-revit` tool/shim for acceptance commands. When developing the SDK itself
   and invoking `Pe.Revit.Cli` with `dotnet run` while Revit holds the signed loader, use an
   already-built CLI (`dotnet run --no-build ...`) for read-only status probes. A normal
   `dotnet run` rebuild can legitimately fail when SignTool tries to replace the loaded DLL; that is
   a build invocation, not a failed runtime-status read.

## Incidents retained for future agents

- An early live run restarted the user RRD after misreading Rider `NoChanges`, causing Revit to discard an unsaved fixture. That was a failed gate and motivated beta.62.
- A dirty sandbox initially blocked on Revit's save dialog; beta.63 fixed ordinary no-save stop. `--force` was used only after that happy-path attempt had failed.
- An unsigned loader approval prompt blocked a disposable Revit process; beta.65 fixed signing. The prompt was not accepted manually.
- The checked-in `Old_Template.rvt` produced 100 geometry errors while enabling worksharing. The destructive “Delete Element(s)” option was refused. Acceptance switched to a new disposable project and never changed the fixture.
- Rider repeatedly broke on a handled shared-log `IOException`. This was debugger first-chance behavior over a real multi-process contention condition, not an uncaught product failure; the logging boundary was hardened and the handled exception was muted/resumed without restarting Revit.
- Repo-wide `vp check` still reports formatting issues in 25 unrelated baseline files. All 13 touched TS files pass formatting/lint/type checks, and the final focused regression suite passes 49/49 across seven files; the managed-log regression passes 1/1.

## Follow-up discussion items

- A first-class acceptance evidence helper is preferable to ad hoc PowerShell object serialization: several early verdict files ballooned because process objects recursively serialized handles/modules.
- Snapshot protected RVT/RFA hashes before opening them in Revit; an active document can deny the helper's independent hash reader even though ordinary no-save close still succeeds.
- If SDK-driven Rider launch/recovery remains a repeated autonomy blocker, consider a narrow `live open-ide`/debugger-orientation command. It must not become implicit build, convergence, or restart behavior.
- Clarify whether `prove-coexistence.ps1` should explicitly distinguish “RRD owns its own output” from true cross-worktree/shared-generation write collisions.
