---
name: execute
description: How a Pe.Tools coding agent executes and proves its code, across every feedback lane — deterministic, compile, artifact, fresh, sandbox, attached, installed, host/web (vp), browser, worktrees (ADR 0007 taxonomy) — and how it runs subagents and background processes (Herdr). Use before running, proving, or delegating anything, when choosing a lane, or when pe-revit/pea/vp/browser commands fail or hang.
---

# Execution

Every run claim carries two coordinates (ADR 0007). **Contact** — `none`, `owned` (agent-owned
fresh/sandbox processes), or `dev` (the user-owned dev session) — says whose session the run
touches. **Proof lane** names which runtime proves the claim: deterministic, compile, artifact,
fresh, sandbox, attached, or installed. The legacy tokens (`FreshRevitProcess`, `AttachedRrd`,
`NoRrdContact`, `RrdRequired`) survive only as literal MSBuild/SDK spellings — prose uses the
plain words. Name lane + contact in every proof claim; "live" is never a lane — it describes
connected-model data, not evidence (`live *` is a command spelling, not a lane).

The SDK owns the mechanics: run `pe-revit guide <live-loop|sandbox|targeting|install|doctor>` for
authoritative walkthroughs — never guess flags (`--help` per family; note help may exit non-zero
while printing correct text). This skill is the Pe.Tools judgment layer: lane choice, the proven
loop shapes, and the lies to defend against.

## Ground rules

- Canonical invocation is `dotnet tool run pe-revit -- <verb>` from the repo/worktree root. Bare
  `pe-revit` resolves the *installed* build — a different binary. From a worktree missing the tool
  manifest, `dotnet tool restore` first (fallback: `pnpm exec pe-revit` from `source/pe-tools`).
- **Lane ownership**: the user owns the dev session and arbitration between agents. You own
  restarts and document opens once a lane is yours — do them yourself via the host's document-open
  op, don't hand them back. Worktree/experimental work never touches the dev session: fresh for
  proof runs, sandbox when you need a durable agent-owned session. If SDK output, computer state,
  and your expectations misalign: STOP and let the user reconcile.
- Preflight before any mutation: `live status --project <P> --year <Y> --json` (+ `sessions --json`,
  `service list`).
- Preflight the boundary too: `Get-Command <tool>` + one version query before install/build/proof;
  every compound command gets an explicit workdir (a backgrounded `cd` never changes the next
  command); prove a guessed path with `rg --files -g <pattern>` before building on it.

## Revit proof lanes, in preference order

1. **deterministic** — contact none. Tests/scorers over saved snapshots, no Revit. Put judgment
   here; spend Revit time only on proof.
2. **fresh** (`test fresh`, token `FreshRevitProcess`) — contact owned; the default autonomous
   Revit-backed proof. The grind that works: `test fresh --plan` after any lane change → edit →
   `test fresh --filter "Name~<OneTest>" --no-build --json` → repeat. `--configuration
   Debug.R<yy>.Tests` XOR `--year` — never both. Parameterize probes via env vars
   (`$env:PE_RHVAC_MODEL=...`) instead of new flags. This is the reliable lane when any Revit
   already owns the machine.
3. **sandbox** — contact owned; durable agent-owned session: `sandbox start --project
   <probe>.csproj --year Y --id <purpose>-r25 --wait --timeout-seconds 600 --json` → `status` →
   `logs --tail N`. Name ids by purpose so concurrent worktrees coexist. `PE_SANDBOX_NO_LAUNCH=1`
   proves the selector gate without a 3-minute launch. Prefer two-step `start` then `wait` so
   failures are attributable. Sandbox is session topology as much as a lane: also name its
   evidence authority — source-backed or installed per the selected runtime.
4. **attached** (`test attached`, token `AttachedRrd`) — contact dev; only when the dev session
   itself is under test AND the payload is proven current (prefer `--no-build` once warm).
5. **installed** — repair recipe when receipts drift: `dotnet tool restore` → `doctor` →
   `service sweep` → `install apply --release latest [--retire-legacy-installers] [--force]` →
   `install verify --json` and read `$j.result.ok` → sandbox with `--installed`.

**Terminal `dotnet build`/`publish` are SAFE beside a running dev session** — the isolated lane
sends bin/obj to `.artifacts/` and the SDK errors on any deploy/launch from it
(`Pe.Revit.Common.targets`). **Raw `dotnet test` is the banned verb** — it drives its own Revit
open/close (or reuses the running session under an IDE) and can race the emitter into a spurious
`restart-required`. Use `pe-revit test fresh`, or `attached --no-build` when the payload is
proven current.

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

## Host/web lane (TypeScript)

- Host/web-only edits use this lane's own loop; restart Revit only when the in-process add-in
  boundary or an SDK verdict requires it.
- Run host+web in a Herdr pane (see the Herdr section): `vp run dev` for `@pe/host` (single
  dynamic port breaks launch.jsons and hardcoded ports). Plain `@pe/web` `vp run dev` is fine when
  no host contact is needed. The service file is the URL authority — never assume 5180.
- **`vp check` is a gate, not a poll**: `vp check --fix <targets>` once, then `vp check <targets>`
  once. Never loop it (history: one identical check blind-retried 71 times). When diagnosing,
  separate formatter noise from type/lint output.
- Typegen is session-scoped: `pnpm --filter @pe/host-contracts codegen -- --session
  <bridgeSessionId>` with the exact target session connected. An untargeted `codegen:check` on
  5180 can silently compare against the wrong session — never treat it as isolated proof.

## Host ops and scripts

- Discover, then call: `pea host operations search --query "..."` against the connected session's
  catalog; never guess op keys or shapes.
- **Never put JSON on the command line.** `--request '{...}'` dies in PowerShell/pnpm re-quoting.
  Use the script-file loop:
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

## Browser verification

Readiness is a ladder, not a retry: pane open (`preview_start`) → `read_page`/console → navigate →
screenshot. A hidden pane cannot produce a screenshot, and repeating the screenshot does not make
it visible. **One identical failure is the ceiling** — after it, switch proof (read_page text,
console messages, network requests, or a deterministic test) instead of re-shooting.

## Herdr — subagents and observable background work

Subagents (claude/codex/…) and any process the user might watch — dev servers, long tests — run
in Herdr panes, never harness Agent/background tools: harness runs can't be observed or
interjected, their output is obscured, and a user interrupt kills them (Herdr agents survive).
`herdr --skill` is the version-matched CLI manual — **discovery stays first-class: read it before
any Herdr work the scripts below don't cover**, and probe command groups (`herdr agent`, `herdr
pane`, …) rather than guessing flags. Below is only the earned delta.

- **Launch and prompt through the battle-tested scripts in this skill's directory** — they encode
  every trap we've hit; don't re-derive the dance by hand:
  - `herdr-up.sh S CWD name:kind ...` — headless server + workspace + one pane per agent,
    idempotent (re-run reuses existing agents, never double-splits). claude agents launch with
    `--dangerously-skip-permissions`: approvals are designed out at launch, never babysat at the
    dialog. Prints name→pane; immediately tell the user S, the agent names, and
    `herdr session attach S`.
  - `herdr-send.sh S NAME PROMPT_FILE` — one-hop delivery: prompt from file, poll to `working`,
    nudge-enter, one full retry. Exists because prompt acceptance ≠ submission ≠ execution:
    codex leaves large prompts as unsubmitted `[Pasted Content]` (the nudge submits), and a
    claude first-launch notice eats prompt #1 (the retry lands). Exit 0 = verified working;
    nonzero dumps the pane tail. Blank lines are collapsed (they can swallow a prompt).
- This harness is outside `HERDR_ENV`; the binary is
  `C:\Users\kaitp\AppData\Local\Programs\Herdr\bin\herdr.exe` (off PATH). Dedicated named
  session, `--session S` on **every** command — never the default session, UI focus, or
  `--current` (the scripts pin this). `MSYS_NO_PATHCONV=1` before any `send-text` from bash —
  without it Git Bash rewrites `/quit` into `C:/Program Files/Git/quit`. IDs come from parsed
  JSON, never guessed. One prompt owner per agent.
- Health poll: `agent list`. `idle|done` both mean complete (focus flips done→idle); `blocked` =
  needs input; `unknown` proves nothing. If a permissioned agent still blocks on a dialog, the
  only sanctioned answer is read-the-pane then `send-keys enter` for the highlighted default —
  never guess numeric options (a guessed "2" has interrupted a turn and toggled modes).
- **Wake/chain/queue**: no queue primitive — the orchestrator owns sequencing. Chain by
  backgrounding `herdr --session S agent wait <name> --until idle --until done --until blocked
  --timeout MS`; its task-notification is the wake. But **watchers are disposable, disk is
  durable**: they die with the parent session (proven by fork), while Herdr agents survive.
  Every mission names a report file; after any resume/fork/doubt, first commands are `agent
  list` + `ls` the report dir — never assume a watcher fired, and recreate watchers freely.
  Urgent redirect: `send-keys <name> esc` → verify settled → re-prompt. On a group timeout
  inspect each agent individually.
- Reads are terminal snapshots (`recent-unwrapped` for transcripts). Alt-screen rows never reach
  scrollback — if more `--lines` reveals nothing, ask the agent to write Markdown to
  `.artifacts/tmp/` and return the path (fallback only, never the opening ask).
- Dev servers / long tests: `pane run` → `pane wait-output --match <ready-line>` → `pane read`.
  Readiness comes from output, not a port guess — why launch.jsons lose to panes here.
- Retain panes for the user's inspection; close only what this run created; never stop a shared
  session or server. Prompts execute with the pane agent's permissions — treat them as
  privileged. `notification show` is config-gated (disabled today).

## Timeouts, backgrounding, cleanup

- Revit operations are minutes-scale. The shell's default timeout (often 2min, sometimes less)
  silently overrides `--timeout-seconds` — a killed client does NOT cancel the server: the orphan
  keeps running, then blocks the next run (`fresh.year-busy`, `converge-busy`). Rule: set the
  client timeout ≥ the CLI timeout, or run in background with `--json > file` and poll the file /
  use a Monitor until-loop. Never sleep-then-poll; never re-invoke after a client timeout without
  a `status` read first.
- The same applies to build/pack/install parents: a client timeout leaves children holding file
  locks, and sibling `TaskCanceledException`s are fallout, not the root error. Capture the raw
  child output, resolve the exact parent/descendant tree, clean only that tree, then rerun.
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
| robocopy exit 0–7 | success tiers — only ≥8 is failure |
| native-exe stderr under `2>&1` | PowerShell fabricates NativeCommandError on advisory banners — read the payload, not the wrapper |
| exit 0 carrying `*.unknown-id` / refusal codes | a refusal — read `diagnostics[].code`, not the exit |
| herdr group help exit 2 / server errors exit 1 | help prints to stderr by design; errors are JSON on stderr — read the payload |

Every `--json` envelope carries `diagnostics[{code,detail,fix}]` and `nextSteps[]` — read and
follow the `fix:` line before inventing your own remedy; but know its limits (a selector refusal
once prescribed the wrong fix for a dev-sign byte mismatch — when the prescribed fix fails once,
diagnose bytes/signatures, don't re-run the prescription). Judge documented state/payload before
the process exit code; Windows shell-tax rules (quoting, globs, one-failure switch) live in
`AGENTS.md`.

## Guardrails

- Never `Stop-Process`/`Start-Process`/`taskkill` Revit.exe by hand — `pe-revit live stop|converge --restart`, `sandbox`, `sessions`, and `service` own process lifecycle. The one exception is the quarantine-unstick recipe: kill only a pid whose command line verifiably matches the orphaned test run. Exact descriptors and PIDs route actions; preserve unrelated worktrees and installed sessions.
- Never treat an open document as implicit — check status or open it via the host op.
- Never infer freshness from an isolated terminal build, an old log line, or a matching filename.
- Never use harness worktree tools. Create worktrees from the command line (`git worktree add`)
  as siblings of the repo (`~/source/repos/Pe.Tools-<slug>`), never nested inside it.

## Reporting

Every proof claim names its lane. For spatial/model claims, images of the solver's actual
inputs — a metric can rise while the render lies, and "test-metric-maxxing" is a named failure
mode here. Never imply a model or file change happened without tool-confirmed evidence.
Doctrine changes are scored by `tools/loop-metrics.py` against the 2026-08 baseline.
