---
name: execute
description: How to execute code across every feedback lane (ADR 0007 taxonomy) - deterministic, compile, artifact, fresh, sandbox, attached, installed, host/web (vp), browser, worktrees. And, how to run subagents and background processes (Herdr multiplexer). As a Pe.Tools coding agent, use before testing, probing, delegating, proving, when choosing a lane, or to diagnose a pe-revit/pea/vp/browser fail or hang.
---

# Execution

Every run claim carries two coordinates (ADR 0007). **Contact**, `none`, `owned` (agent-owned
fresh/sandbox processes), or `dev` (the user-owned dev session), says whose session the run
touches. **Proof lane** names which runtime proves the claim: deterministic, compile, artifact,
fresh, sandbox, attached, or installed. Tokens and prose both use the plain words, the SDK
renamed its MSBuild spellings at beta.117; residual `Rrd` spellings live only in Pe.Tools's own
`build/ExecutionPolicy.cs`. Name lane + contact in every proof claim; "live" is never a lane, it describes
connected-model data, not evidence (`live *` is a command spelling, not a lane).

The SDK owns the mechanics: run `pe-revit guide <live-loop|sandbox|targeting|install|doctor>` for
authoritative walkthroughs, never guess flags (`--help` per family). This skill is the Pe.Tools
judgment layer: lane choice, the proven loop shapes, and the lies to defend against. Defensive lines
carry `(dies when: …)`, the queued fix that retires them; delete them with the pin bump that ships
it, never before.

## Ground rules

- Canonical invocation is `dotnet tool run pe-revit -- <verb>` from the repo/worktree root. Bare
  `pe-revit` resolves the *installed* build, a different binary. From a worktree missing the tool
  manifest, `dotnet tool restore` first (fallback: `pnpm exec pe-revit` from `source/pe-tools`).
  Every envelope names its answerer in `binary{executable,root,rule}`, read it before believing
  an odd answer.
- **`pea` is checkout-pinned, not worktree-safe**: its dev shim routes to the main checkout, and
  the shim discloses its resolved target, read the disclosure, and from a worktree treat `pea`
  results as evidence about the tree it names, not yours.
- **Lane ownership**: the user owns the dev session and arbitration between agents. You own
  restarts and document opens once a lane is yours, do them yourself via the host's document-open
  op, don't hand them back. Worktree/experimental work never touches the dev session: fresh for
  proof runs, sandbox when you need a durable agent-owned session. If SDK output, computer state,
  and your expectations misalign: STOP and let the user reconcile.
- Preflight before any mutation: `live status --project <P> --year <Y> --json` (+ `sessions --json`,
  `service list`).
- Preflight the boundary too: `Get-Command <tool>` + one version query before install/build/proof;
  every compound command gets an explicit workdir (a backgrounded `cd` never changes the next
  command); prove a guessed path with `rg --files -g <pattern>` before building on it.

## Revit proof lanes, in preference order

1. **deterministic**, contact none. Tests/scorers over saved snapshots, no Revit. Put judgment
   here; spend Revit time only on proof. `test deterministic --project <P>` owns this rung: no
   year lease, no quarantine.
2. **fresh** (`test fresh`), contact owned; the default autonomous
   Revit-backed proof. The grind that works: `test fresh --plan` after any lane change → edit →
   `test fresh --filter "Name~<OneTest>" --no-build --json` → repeat. `--configuration
   Debug.R<yy>.Tests` XOR `--year`, never both. Parameterize probes via env vars
   (`$env:PE_RHVAC_MODEL=...`) instead of new flags. This is the reliable lane when any Revit
   already owns the machine.
3. **sandbox**, contact owned; durable agent-owned session: `sandbox start --project
   <probe>.csproj --year Y --id <purpose>-r25 --wait --timeout-seconds 600 --json` → `status` →
   `logs --tail N`. Ready in ~1 min, and it neither takes nor waits on the fresh-lane year lease.
   Name ids by purpose so concurrent worktrees coexist (`start` on an existing id names what it
   displaces). `PE_SANDBOX_NO_LAUNCH=1` proves the selector gate without launching.
   Prefer two-step `start` then `wait` so failures are attributable. Sandbox is session topology as
   much as a lane: also name its evidence authority, source-backed or installed per the runtime.
4. **attached** (`test attached`), contact dev; only when the dev session
   itself is under test AND the payload is proven current (prefer `--no-build` once warm).
5. **installed**, when receipts drift, `install repair` runs the ladder and reports which rung
   fixed it; never hand-roll it. Then sandbox with `--installed`.

**Terminal `dotnet build`/`publish` are SAFE beside a running dev session**, the isolated lane
sends bin/obj to `.artifacts/` and the SDK errors on any deploy/launch from it
(`Pe.Revit.Common.targets`). **Raw `dotnet test` is banned for Revit-backed projects**, it drives
its own Revit open/close (or reuses the running session under an IDE) and can race the emitter into
a spurious `restart-required`. Use `pe-revit test fresh`, `attached --no-build` when the payload
is proven current, or `test deterministic` for year-neutral projects.

## The converge ladder (hot reload)

Converge is dev contact only, no owned-contact hot-reload lane exists (SDK design gap, NEXT.md
W5). With no dev session present, converge would CREATE one in the user's checkout: autonomous
runs prove via fresh/sandbox instead.

`live converge` → exit 3 `[restart-required]` is a STATE, not an error; escalate exactly one step
per attempt: `--restart` → (only if the pid is verifiably stuck) `--restart --force` → poll
`live status` through booting → watching. `[booting]` is progress, never re-issue converge over
it, and after any restart give a 10-20s `live watch` buffer before document ops. Exit 3 is never
fixed by re-running the bare form.

An emitter failure is a non-zero converge (`blocked`/exit 3), not a green one, trust the exit
contract. Before claiming a hot reload landed, re-run the changed behavior. The evidence
gradient, weakest to strongest: compile <
`Applied` < fresh loaded path < changed behavior, `Applied` alone proves delta acceptance, not
product behavior; report the strongest evidence actually obtained. Which edits hot-reload vs
require restart is SDK-owned truth: `docs/HOT_RELOAD.md` in Pe.Revit.Sdk (member-shape,
WPF/BAML/resource, and startup edits restart). After a restart Revit returns to Home, reopening
the fixture via the host's document-open op is agent-owned, not a reason to hand back. If status
reports a pending approval dialog, `pe-revit live approve` is the unblock (dev signing is primary).

## Host/web lane (TypeScript)

- Host/web-only edits use this lane's own loop; restart Revit only when the in-process add-in
  boundary or an SDK verdict requires it.
- Run host+web in a Herdr pane (see the Herdr section): `vp run dev` for `@pe/host` (single
  dynamic port breaks launch.jsons and hardcoded ports). Plain `@pe/web` `vp run dev` is fine when
  no host contact is needed. The service file is the URL authority, never assume 5180.
- **`vp check` is a gate, not a poll**: `vp check --fix <targets>` once, then `vp check <targets>`
  once. Never loop it (history: one identical check blind-retried 71 times). When diagnosing,
  separate formatter noise from type/lint output.
- Typegen is two lanes (`7af1eba`): `codegen`/`codegen:check` are OFFLINE projections from
  `pe-dev ops-catalog`, deterministic, no session involved, and they silently swallow a
  `--session` arg (drive B-10); `codegen:verify-live -- --session <bridgeSessionId>` is the
  session-targeted parity check against a running host. Name the lane in any typegen proof
  claim. (dies when: Pe.Tools offline codegen refuses unused `--session`, host ledger)

## Host ops and scripts

- Discover, then call: `pea host operations search --query "..."` against the connected session's
  catalog; never guess op keys or shapes.
- **Never put JSON on the command line.** `--request '{...}'` dies in PowerShell/pnpm re-quoting.
  Use the script-file loop:
  write a `.cs` to `.artifacts/tmp/<run>/`, then `pea script execute --host http://127.0.0.1:<port>
  --bridge-session-id <id> --permission-mode <ReadOnly|WriteTransaction> --file x.cs`, ending with
  a read-back step. (Or POST `/call` with a heredoc body.) Explicit `--host` URL beats `--host dev`
  token resolution, which fails even inside the checkout. (dies when: Pe.Tools pea `--request-file`
  + `--host dev` resolution, host ledger)
- Treat `{ok:true}` with an empty/thin payload as a *suspect* answer, not a fact, cross-check one
  independent source (Revit.ini, disk, netstat) before reporting it, and know which host answered:
  op envelopes carry no host identity yet. (dies when: Pe.Tools op-envelope identity +
  `emptyBecause`, host ledger)
- ReadOnly script mode is NOT containment, a probe has persisted model changes. Treat every
  script as a write until the read-back proves otherwise; end mutation scripts with
  read-back + compare (the only false-success in two months that was caught in-loop carried its
  own SHA compare). The templates themselves concede document rollback ≠ machine isolation.
  (dies when: `Pe.Revit.Scripting` honest rename, host ledger; never trim early)

## Browser verification

Readiness is a ladder, not a retry: pane open (`preview_start`) → `read_page`/console → navigate →
screenshot. A hidden pane cannot produce a screenshot, and repeating the screenshot does not make
it visible. **One identical failure is the ceiling**, after it, switch proof (read_page text,
console messages, network requests, or a deterministic test) instead of re-shooting.

## Herdr, subagents and observable background work

Subagents (claude/codex/…) and any process the user might watch, dev servers, long tests, run
in Herdr panes, never harness Agent/background tools: harness runs can't be observed or
interjected, their output is obscured, and a user interrupt kills them (Herdr agents survive).
`herdr --skill` is the version-matched CLI manual, **discovery stays first-class: read it before
any Herdr work the scripts below don't cover**, and probe command groups (`herdr agent`, `herdr
pane`, …) rather than guessing flags. Below is only the earned delta.

- **Launch and prompt through the battle-tested scripts in this skill's directory**, they encode
  every trap we've hit; don't re-derive the dance by hand. They are PowerShell (the convention
  shell here; PS 5.1-safe, ASCII-only source, no stderr redirects under EAP=Stop, quote-escaped
  native args, warnings not throws so callers read exit codes):
  - `herdr-up.ps1 S CWD name:kind[:model] ...`, headless server + workspace + one pane per agent,
    idempotent (re-run reuses existing agents, never double-splits, and recovers one stuck on a
    startup dialog). claude agents launch with `--dangerously-skip-permissions` (`:model` maps to
  `--model`): approvals are designed out at launch, never babysat at the dialog, the consent
    dialog itself blocks startup and is auto-accepted by the script's settle loop (`agent start`
    exits nonzero there while the agent IS registered; settle owns the verdict). Prints name→pane;
    immediately tell the user S, the agent names, and `herdr session attach S`.
  - `herdr-send.ps1 S NAME PROMPT_FILE`, one-hop delivery: prompt from file, poll to `working`,
    nudge-enter, one full retry. Exists because prompt acceptance ≠ submission ≠ execution:
    codex leaves large prompts as unsubmitted `[Pasted Content]` (the nudge submits), and a
    claude first-launch notice eats prompt #1 (the retry lands). Exit 0 = verified working;
    nonzero dumps the pane tail. Blank lines are collapsed (they can swallow a prompt).
- This harness is outside `HERDR_ENV`; `herdr` is on PATH in both PowerShell and Git Bash
  (verified 2026-08-18, the old "off PATH" claim was stale). Dedicated named session,
  `--session S` on **every** command, never the default session, UI focus, or `--current`
  (the scripts pin this). Never drive an agent's slash-commands through `send-text` from Git Bash,
  MSYS path-mangling rewrites `/quit` into `C:/Program Files/Git/quit`; `agent prompt` owns anything
  starting with `/` (`MSYS_NO_PATHCONV=1` only rescues non-agent `send-text`). IDs come from parsed
  JSON, never guessed. One prompt owner per agent.
- Sibling agents in one checkout serialize on build/`bin` locks, stagger builds or scope missions to
  disjoint proof steps; a "slow" agent is usually waiting on its sibling's lock, not thinking.
- Health poll: `agent list`, prompt acceptance echoes the agent's *current* state, so verify there
  after every send. `idle|done` both mean complete (focus flips done→idle); `blocked` =
  needs input; `unknown` proves nothing. If a permissioned agent still blocks on a dialog, the
  only sanctioned answer is read-the-pane then `send-keys enter` for the highlighted default,
  never guess numeric options (a guessed "2" has interrupted a turn and toggled modes).
- **Wake/chain/queue**: no queue primitive, the orchestrator owns sequencing. Chain by
  backgrounding `herdr --session S agent wait <name> --until idle --until done --until blocked
  --timeout MS`; its task-notification is the wake. But **watchers are disposable, disk is
  durable**: they die with the parent session (proven by fork), while Herdr agents survive.
  Every mission names a report file; after any resume/fork/doubt, first commands are `agent
  list` + `ls` the report dir, never assume a watcher fired, and recreate watchers freely.
  Urgent redirect: `send-keys <name> esc` → verify settled → re-prompt. On a group timeout
  inspect each agent individually.
- Reads are terminal snapshots (`recent-unwrapped` for transcripts). Alt-screen rows never reach
  scrollback, if more `--lines` reveals nothing, ask the agent to write Markdown to
  `.artifacts/tmp/` and return the path (fallback only, never the opening ask).
- Dev servers / long tests: `pane run` → `pane wait-output --match <ready-line>` → `pane read`.
  Readiness comes from output, not a port guess, why launch.jsons lose to panes here.
- Retain panes for the user's inspection; close only what this run created; never stop a shared
  session or server. Throwaway sessions this run created are the exception: `herdr session stop S`
  then `session delete S` (no `--session` prefix on these). Prompts execute with the pane agent's permissions, treat them as
  privileged. `notification show` is config-gated (disabled today).

## Timeouts, backgrounding, cleanup

- Revit operations are minutes-scale. The shell's default timeout (often 2min, sometimes less)
  silently overrides `--timeout-seconds`, so set the client timeout ≥ the CLI timeout, or background
  with `--json > file` and poll the file / a Monitor until-loop. Never sleep-then-poll; read `status`
  before any retry. The SDK reaps its own children, a killed client left no orphan and no
  `fresh.year-busy` in the beta.118 drill; if one appears anyway, `test fresh --unstick` owns it,
  never hand process surgery.
- Never probe CLI surface through app-booting wrappers (`pnpm run pea -- --help` boots the app);
  never foreground a smoke suite to read three tail lines, background once, tee, poll.
- The permission sandbox can block localhost HTTP, indistinguishable from a dead host. Probe
  127.0.0.1 unsandboxed, or via the SDK surface.

## What to trust (exit codes lie here)

| Signal | Truth |
|---|---|
| exit 255 from a `pe-revit`/`pea` run | phantom: SDK exit codes verified honest, you truncated a native pipe mid-write (`Select-Object -First N`) or wrapped stderr. Never `Select-Object -First`/`head` a live native command; tee to a file, then read |
| op `{ok:true}` empty payload | cross-check an independent source (dies when: Pe.Tools `emptyBecause`, host ledger) |
| rg exit 1 | "no matches", a finding, not a failure |
| robocopy exit 0–7 | success tiers, only ≥8 is failure |
| herdr group help exit 2 / server errors exit 1 | help prints to stderr by design; errors are JSON on stderr, read the payload |

Every `--json` envelope carries `diagnostics[{code,detail,fix}]` and `nextSteps[]`, read and
follow the `fix:` line before inventing your own remedy; when a prescribed fix fails once,
diagnose, don't re-run the prescription. Judge documented state/payload before the process exit
code; Windows shell-tax rules (quoting, globs, one-failure switch) live in `AGENTS.md`.

## Guardrails

- Never `Stop-Process`/`Start-Process`/`taskkill` Revit.exe by hand, `pe-revit live stop|converge --restart`, `sandbox`, `sessions`, and `service` own process lifecycle, and `test fresh --unstick` owns quarantine/lease reclaim. Exact descriptors and PIDs route actions; preserve unrelated worktrees and installed sessions.
- Never treat an open document as implicit, check status or open it via the host op.
- Never infer freshness from an isolated terminal build, an old log line, or a matching filename.
- Never use harness worktree tools. Create worktrees from the command line (`git worktree add`)
  as siblings of the repo (`~/source/repos/Pe.Tools-<slug>`), never nested inside it.

## Reporting

Every proof claim names its lane. For spatial/model claims, images of the solver's actual
inputs, a metric can rise while the render lies, and "test-metric-maxxing" is a named failure
mode here. Never imply a model or file change happened without tool-confirmed evidence.
Doctrine changes are scored by `tools/loop-metrics.py` against the 2026-08 baseline.
