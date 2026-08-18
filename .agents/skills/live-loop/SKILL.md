---
name: live-loop
description: Drive and verify work against live Revit — sessions, sandboxes, hot reload, test lanes, host operations, pea scripting. Use before touching any Revit session or host, when a change must be proven live, or when pe-revit/pea/vp commands fail or hang. Distilled from two months of real session postmortems.
---

# Live loop

The SDK owns the mechanics: run `pe-revit guide <live-loop|sandbox|targeting|install|doctor>` for
authoritative walkthroughs — never guess flags (`--help` per family; note help may exit non-zero
while printing correct text). This skill is the Pe.Tools judgment layer: lane choice, the proven
loop shapes, and the lies to defend against.

## Ground rules

- Canonical invocation is `dotnet tool run pe-revit -- <verb>` from the repo/worktree root. Bare
  `pe-revit` resolves the *installed* build — a different binary. From a worktree missing the tool
  manifest, `dotnet tool restore` first (fallback: `pnpm exec pe-revit` from `source/pe-tools`).
- **Lane ownership**: the user owns the dev (RRD) session and arbitration between agents. You own
  restarts and document opens once a lane is yours — do them yourself via the host's document-open
  op, don't hand them back. Worktree/experimental work → sandbox lane, never RRD. If SDK output,
  computer state, and your expectations misalign: STOP and let the user reconcile.
- Preflight before any mutation: `live status --project <P> --year <Y> --json` (+ `sessions --json`,
  `service list`) — every session that opened with a status read recovered faster than every one
  that opened with a converge.

## Proof lanes, in preference order

1. **No-Revit inner loop** — deterministic tests/scorers over saved snapshots. Put judgment here;
   spend live Revit only on proof.
2. **Fresh** (`test fresh`) — the default live proof. The grind that works: `test fresh --plan`
   after any lane change → edit → `test fresh --filter "Name~<OneTest>" --no-build --json` →
   repeat. `--configuration Debug.R<yy>.Tests` XOR `--year` — never both. Parameterize probes via
   env vars (`$env:PE_RHVAC_MODEL=...`) instead of new flags. This is the reliable lane when any
   Revit already owns the machine.
3. **Sandbox** — durable agent-owned session: `sandbox start --project <probe>.csproj --year Y
   --id <purpose>-r25 --wait --timeout-seconds 600 --json` → `status` → `logs --tail N`. Name ids
   by purpose so concurrent worktrees coexist. `PE_SANDBOX_NO_LAUNCH=1` proves the selector gate
   without a 3-minute launch. Prefer two-step `start` then `wait` so failures are attributable.
4. **Attached** (`test attached`) — only when the RRD session itself is under test AND the payload
   is proven current (prefer `--no-build` once warm).
5. **Installed** — repair recipe when receipts drift: `dotnet tool restore` → `doctor` →
   `service sweep` → `install apply --release latest [--retire-legacy-installers] [--force]` →
   `install verify --json` and read `$j.result.ok` → sandbox with `--installed`.

**Terminal `dotnet build`/`publish` are SAFE beside a live session** — the isolated lane sends
bin/obj to `.artifacts/` and the SDK errors on any deploy/launch from it (`Pe.Revit.Common.targets`).
**Raw `dotnet test` is the banned verb**: not output trees — it drives its own Revit open/close
(Fresh runsettings), or under an IDE resolves Warm and reuses the live session; its long WPF build
also races the emitter with a transient `Pe.Revit.Ui/*_wpftmp.csproj`, read as added build config →
`restart-required` (one reproduction, 2026-07-24; benign, recovered by `converge --restart`). Use
`pe-revit test fresh`, or `attached --no-build` when the payload is proven current.

## The converge ladder (hot reload)

`live converge` → exit 3 `[restart-required]` is a STATE, not an error; escalate exactly one step
per attempt: `--restart` → (only if the pid is verifiably stuck) `--restart --force` → poll
`live status` through booting → watching. `[booting]` is progress — never re-issue converge over
it, and after any restart give a 10-20s `live watch` buffer before document ops. Exit 3 is never
fixed by re-running the bare form.

**Converge exit 0 is not proof.** One compile error anywhere in the project blocks every apply
while converge stays green. Before claiming a hot reload landed, check the events journal for
`emit-failed` (read the journal path from the command's own output — never hunt log directories),
then re-run the changed behavior. The evidence gradient, weakest to strongest: compile <
`Applied` < fresh loaded path < changed behavior — `Applied` alone proves delta acceptance, not
product behavior; report the strongest evidence actually obtained. Which edits hot-reload vs
require restart is SDK-owned truth: `docs/HOT_RELOAD.md` in Pe.Revit.Sdk (member-shape,
WPF/BAML/resource, and startup edits restart). After a restart Revit returns to Home — reopening
the fixture via the host's document-open op is agent-owned, not a reason to hand back. If status
reports a pending approval dialog, `pe-revit live approve` is the unblock (dev signing is primary).

## Host ops and scripts

- Discover, then call: `pea host operations search --query "..."` against the live catalog; never
  guess op keys or shapes.
- **Never put JSON on the command line.** `--request '{...}'` dies in PowerShell/pnpm re-quoting —
  two months of history show 6-8 wasted quoting attempts per incident. Use the script-file loop:
  write a `.cs` to `.artifacts/tmp/<run>/`, then `pea script execute --host http://127.0.0.1:<port>
  --bridge-session-id <id> --permission-mode <ReadOnly|WriteTransaction> --file x.cs`, ending with
  a read-back step. (Or POST `/call` with a heredoc body.) Explicit `--host` URL beats `--host dev`
  token resolution, which fails even inside the checkout.
- Treat `{ok:true}` with an empty/thin payload as a *suspect* answer, not a fact — cross-check one
  independent source (Revit.ini, disk, netstat) before reporting it. Know which host answered:
  the installed shim will happily return green answers about the wrong binary.
- ReadOnly script mode is NOT containment — a probe has persisted model changes. Treat every
  script as a write until the read-back proves otherwise; end mutation scripts with
  read-back + compare (the only false-success in two months that was caught in-loop carried its
  own SHA compare).

## Timeouts and backgrounding

- Revit operations are minutes-scale. The shell's default timeout (often 2min, sometimes less)
  silently overrides `--timeout-seconds` — a killed client does NOT cancel the server: the orphan
  keeps running, then blocks the next run (`fresh.year-busy`, `converge-busy`). Rule: set the
  client timeout ≥ the CLI timeout, or run in background with `--json > file` and poll the file /
  use a Monitor until-loop. Never sleep-then-poll; never re-invoke after a client timeout without
  a `status` read first.
- Quarantine unstick (`fresh.year-busy`): `test fresh --plan` → `Get-CimInstance Win32_Process |
  ? { $_.CommandLine -match 'test fresh|Pe.Revit' }` → kill the orphan → rerun.
- Never probe CLI surface through app-booting wrappers (`pnpm run pea -- --help` boots the app);
  never foreground a smoke suite to read three tail lines — background once, tee, poll.
- The permission sandbox can block localhost HTTP — indistinguishable from a dead host. Probe
  127.0.0.1 unsandboxed, or via the SDK surface.

## What to trust (exit codes lie here)

| Signal | Truth |
|---|---|
| `install verify` text `[ok]` / exit 255 | `--json` → `result.ok` only |
| `converge` exit 0 | + events journal has no `emit-failed` |
| `sessions` rows | `[pid-reused]`/stale marks disqualify a row; netstat confirms ports |
| op `{ok:true}` empty payload | cross-check an independent source |
| rg exit 1 | "no matches" — a finding, not a failure |
| native-exe stderr under `2>&1` | PowerShell fabricates NativeCommandError on advisory banners — read the payload, not the wrapper |
| exit 0 carrying `*.unknown-id` / refusal codes | a refusal — read `diagnostics[].code`, not the exit |

Every `--json` envelope carries `diagnostics[{code,detail,fix}]` and `nextSteps[]` — read and
follow the `fix:` line before inventing your own remedy; but know its limits (a selector refusal
once prescribed the wrong fix for a dev-sign byte mismatch — when the prescribed fix fails once,
diagnose bytes/signatures, don't re-run the prescription).

## Guardrails

- Never `Stop-Process`/`Start-Process`/`taskkill` Revit.exe by hand — `pe-revit live stop|converge --restart`, `sandbox`, `sessions`, and `service` own process lifecycle. The one exception is the quarantine-unstick recipe: kill only a pid whose command line verifiably matches the orphaned test run. Exact descriptors and PIDs route actions; preserve unrelated worktrees and installed sessions.
- Never treat an open document as implicit — check status or open it via the host op.
- Never infer freshness from an isolated terminal build, an old log line, or a matching filename.
- Host/web-only edits use that package's own dev loop; restart Revit only when the in-process
  add-in boundary or an SDK verdict requires it.
- Never use harness-provided worktree creation tools, Windows stability industry-wide is iffy. Create them from the command line (`git worktree add`) as siblings of the repo (`~/source/repos/Pe.Tools-<slug>`), never nested inside it.

## Measuring the loop itself

`python tools/loop-metrics.py --since <date>` scores real session history (error%, timeouts,
blind retries per command family). Run it after doctrine or SDK changes; the delta against the
2026-08 baseline (`.artifacts/runs/history-mining-20260818/`) is the evidence the loop improved.

## Reporting

Colloquial and short; behavior first. For spatial/model claims, images of the solver's actual
inputs — a metric can rise while the render lies, and "test-metric-maxxing" is a named failure
mode here. Never imply a model or file change happened without tool-confirmed evidence.
