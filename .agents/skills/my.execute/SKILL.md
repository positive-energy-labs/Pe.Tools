---
name: execute
description: How to execute code across every proof lane - deterministic, compile, artifact, the pe-revit test ladder (deterministic/fresh/attached rungs), controlled Revit sessions (dev/installed), documents, op receipts, host/web (vp), browser, worktrees. And, how to run subagents and background processes (Herdr multiplexer). As a Pe.Tools coding agent, use before testing, probing, delegating, proving, when choosing a lane, or to diagnose a pe-revit/pea/vp/browser fail or hang.
---

# Execution

Every run claim names its **proof lane** (which runtime proves it: deterministic, compile,
artifact, fresh, attached, installed) and, when a Revit is involved, the session's **custody**
(`controlled` = pe-revit holds its registry receipt and may mutate it; `observed` = no receipt,
status and document reads only). "Live" is never a lane; `sandbox` and `owner` are retired words.

**Nothing about Pe.Tools tooling is "stock", because the stock sucked; everything must be learned.**
The platforms and the world at large are against you, in every way imaginable. The current DX of
proof/execution is hard won and probably different from last week. Doubt memory, and make sure the
tooling for your lane works before getting deep in implementation.

**Tooling/env issues are signal.** Note them throughout your execution loop and surface them to the
user; they will request capture or command the fix delegated immediately. Prime suspects we "fix"
often: **worktree tolerance** across surfaces, `@pe/host` ports/processes, `Pe.Revit.Sdk`/`pe-revit`,
and the `Pe.App`-to-`@pe/host` connection model. **The matrix of process type, proof lane, and
checkout/clone type is immense**, and every axis affects the others. Don't suggest a fix unless you
know enough about the broader implications, and leverage conventional patterns where possible
(e.g. `dotnet build`/`publish`).

The SDK owns the mechanics: `pe-revit guide <topic>` (`guide` lists them; `session` and `test`
first) are the authoritative walkthroughs; never guess flags (`--help` per family). This skill is the Pe.Tools judgment layer:
lane choice, the proven loop shapes, and the lies to defend against. Defensive lines carry
`(dies when: …)`, the queued fix that retires them; delete them with the change that ships it.

## Ground rules

- Canonical invocation is `dotnet tool run pe-revit -- <verb>` from the repo/worktree root. Bare
  `pe-revit` resolves the *installed* build. Every envelope names its answerer in
  `binary{executable,root,rule}`; human mode prints `binary root:` whenever it is not your cwd's
  repo — read it before believing an odd answer, especially from a worktree.
- **`pea` is checkout-pinned, not worktree-safe**: its dev shim routes to the main checkout and
  discloses the target; from a worktree treat `pea` results as evidence about the tree it names.
- **Custody**: the resolver refuses every mutation on an `observed` Revit; you never need to guard
  it yourself. The user's own Revit is observed unless they started it through `pe-revit`. Once a
  controlled session is yours, restarts and document opens are yours too — do them, don't hand back.
  If SDK output, machine state, and your expectations misalign: STOP and let the user reconcile.
- Preflight before any mutation: `session status --json` (custody, origin, lane, buildStamp,
  legs[], documents[] per row; `resolved` is null on `status` — read `sessions[]` yourself).
  **`ready` means the SDK bridge answered, not that the product loaded**: `session logs --id N`
  is the only witness for `LoaderStartupFailed Pe.App` (dies when: start/status surface loader
  failures as diagnostics, SDK).
- Preflight the boundary too: explicit workdir on every compound command; prove a guessed path with
  `rg --files -g <pattern>` before building on it.

## Proof lanes, in preference order

1. **deterministic**, no Revit. `pe-revit test --project <P>` picks this rung by itself for a
   year-neutral project. Put judgment here; spend Revit time only on proof.
2. **fresh**, the default Revit-backed proof: `pe-revit test --project <RevitTests csproj>` picks
   it for a Revit-backed project, launches its own ephemeral **controlled** Revit (row
   `{stem}-fresh-{yy}`, `origin: test`, visible in `session status`, swept by `session gc`), and
   holds the per-year quarantine lease. Grind: `test --plan` after any lane change → edit →
   `test --filter "Name~<OneTest>" --no-build` → repeat. `--year` XOR `--configuration`.
   Parameterize probes via env vars (`$env:PE_RHVAC_MODEL=...`) instead of new flags.
3. **attached**, against a controlled session you name: `test --attach --id <session>`; it
   converges that session first (`--no-build` skips the converge). Static refusals are immediate
   and typed (`test.attach-preflight`).
4. **installed**: `install repair` runs the ladder and reports which rung fixed it; then a bare
   `session start --year Y` (no `--project`) runs the installed payload under a controlled id.

`--plan` on `test` and `session start` prints the chosen rung/legs and the exact commands without
running them — use it before every Revit-contacting run in a new worktree.

**Terminal `dotnet build`/`publish` are SAFE beside a running session** (isolated lane → `.artifacts/`,
deploy/launch refused). A running session holds no lock on your tree: the emitter baselines the
generation copy, so `dotnet build` succeeds while it watches. **Raw `dotnet test` is banned for
Revit-backed projects** — it drives its own Revit outside the SDK's lifecycle and quarantine.

## Sessions and hot reload

One noun, one family. `session start --project <P> --year Y [--id N] [--doc <path|recent:T>]`
builds once, byte-copies into an immutable generation, launches Revit with hot reload armed, and
blocks to SDK-ready (~55-90 s cold; `--no-wait` returns at launch, then `session watch`). Without
`--project` the session runs the installed payload. Ids are minted `{project-stem|installed}-{yy}`;
pass `--id` only when you want several sessions of one project+year. Restart is the only
freshness mechanism (`session restart --id N`, keeps the active document; the `keep-doc` leg lists
what it reopened and what it dropped). `session stop`, then `session gc --id N --forget` retires a
row you are done with.

`session converge --id N` is an **attachment act**: it starts the emitter against an already
hot-reloadable session (no session → starts one), never restarts, and is idempotent. The emitter
watches this checkout's source tree — one emitter per checkout. The edit loop:

| Situation | Do |
|---|---|
| emitter watching, ordinary edit | nothing — it applies on save (~1-2 s); `session converge --id N` re-reports `watching` + `encGeneration`, and names the emitter events file |
| rude edit (rename / signature / deleted member) | converge reports `session.restart-required` → `session restart --id N` |
| compile error | converge reports `blocked` → fix the error and save; never restart for it |
| no emitter | `session converge --id N` |

Evidence gradient, weakest to strongest: compile < `apply` event < changed behavior. `apply`
proves delta acceptance, not product behavior; re-run the behavior before claiming a reload
landed. Which edits hot-reload vs require restart is SDK truth (`docs/HOT_RELOAD.md` in
Pe.Revit.Sdk). Unsigned-addin approval is an always-on start leg, not a verb you type.

## Documents and op receipts

Documents are session state: `doc open <path> [--detach] --id N`, `doc current [--doc T|P]`,
`doc close --intent keep|discard [--doc T|P]` (default: the active document; closing the active one hands
activation to another open document first; `--sync` is a cloud write and is refused — synchronize and
relinquish stay user actions), `doc recents` (Revit.ini, no bridge).
`session start --doc` opens on boot; a failed open leaves a RUNNING session + a doc diagnostic.
Every mutating bridge op journals a receipt before it answers: if your shell died mid-op,
`op list --id N` then `op result <requestId>` recovers the answer. Never infer an open document —
read `doc current`.

## Host/web lane (TypeScript)

- Host/web-only edits use this lane's own loop; restart Revit only when the in-process add-in
  boundary or an SDK verdict requires it.
- Run host+web in a Herdr pane: `vp run @pe/host#dev` from `source/pe-tools` (single dynamic
  port breaks launch.jsons and hardcoded ports). Plain `vp run @pe/web#dev` is fine when no host
  contact is needed. The service file is the URL authority (`%LOCALAPPDATA%\Positive
  Energy\Pe.Tools\state\service\<name>.json`, schema v3 with `health`; `sessionId` is written
  once the product's bridge registers, so until then a `legBecause: lane:dev` leg is a lane
  match, not proof). A stale SDK sample in `Addins\{year}` (another product's older
  `Pe.Revit.Loader.dll`) wins the loader identity for the whole process — `session logs` shows
  `LoaderStartupFailed` and the first op kills the bridge; `install list` names the culprit. `session status` shows the host as a `leg` of its session (`up|down`,
  `how: health|tcp|pid`, `legBecause`). Never assume 5180. Dev and installed hosts are SIBLINGS —
  a dev host never evicts the installed `host`, so this pane survives a session start through the
  route, and every client picks its host BY LANE: `--host dev | installed | <worktree path> | <url>`.
- The host relays session lifecycle for the browser at `GET /sessions` and `POST /sessions
  {action: start|stop|restart|converge, id?, year?, doc?}` — the SDK envelope passed through
  untouched. `start` takes `lane: installed` (default, the bare CLI meaning) or `dev` (this
  checkout's Pe.App; 400 on a host with no checkout).
- **`vp check` is a gate, not a poll**: `vp check --fix <targets>` once, then `vp check <targets>`
  once. Never loop it. Separate formatter noise from type/lint output when diagnosing. Targets are
  PATHS (`apps/host/src`), never package names: `vp check @pe/host` prints `pass` having checked
  nothing, and a generated-only target (`**/generated/*.ts`) fails "all matched files excluded" —
  neither is a verdict on your code.
- Tests run per package: `vp run @pe/host#test`. `vp test <path>` from the workspace root skips
  the package's `vite.config.ts` test env and fails 6 host files with `PE_LANE must be 'dev' or
  'installed'` — that is the runner, not your edit.
- Typegen is two lanes: `codegen`/`codegen:check` are OFFLINE projections from `pe-dev ops-catalog`
  (no session; they silently swallow `--session`); `codegen:verify-live -- --session <id>` is the
  session-targeted parity check. Name the lane in any typegen claim. (dies when: offline codegen
  refuses unused `--session`, host ledger)
- The SDK's generated TS contract (`clients/ts/generated/pe-revit-contract.ts`, vendored) is the
  only way Pe.Tools code calls `pe-revit`: argv builders + typed envelopes. Never hand-write argv.

## Host ops and scripts

- Discover, then call: `pea host operations search --host <lane> --query "..."` against the
  connected session's catalog; never guess op keys or shapes. It prints the URL it resolved before
  it fetches, and every transport failure names that URL — read it before believing an odd answer.
  Put `--host` AFTER the subcommand: `pea --host dev host operations …` runs the ROOT entry (TUI)
  instead of dispatching, and dies on the shared Mastra thread lock.
- **Never put JSON on the command line.** `--request '{...}'` dies in PowerShell/pnpm re-quoting.
  Write a `.cs` to `.artifacts/tmp/<run>/`, then `pea script execute --host http://127.0.0.1:<port>
  --bridge-session-id <id> --permission-mode <ReadOnly|WriteTransaction> --file x.cs`, ending with
  a read-back step. `--host dev` resolves this worktree's live service file; an explicit URL is
  only needed to reach a host outside it. (dies when: `pea --request-file`, host ledger)
- Treat `{ok:true}` with an empty/thin payload as *suspect*; cross-check one independent source
  before reporting it. (dies when: op-envelope identity + `emptyBecause`, host ledger)
- ReadOnly script mode is NOT containment. Treat every script as a write until the read-back
  proves otherwise; end mutation scripts with read-back + compare. (dies when: `Pe.Revit.Scripting`
  honest rename, host ledger)

## Browser verification

Use the harness's preview tool (t3-code `preview_*` here); with none available, say the UI half
is unproven and prove the route/data path instead. Readiness is a ladder, not a retry: pane open →
snapshot/console → navigate → screenshot. A hidden pane cannot produce a screenshot. **One identical failure is the ceiling** — after it,
switch proof (read_page text, console, network, or a deterministic test) instead of re-shooting.

## Herdr, subagents and observable background work

Subagents (claude/codex/…) and any process the user might watch (dev servers, long tests) run in
Herdr panes, never harness Agent/background tools: harness runs can't be observed or interjected,
and a user interrupt kills them (Herdr agents survive). `herdr --skill` is the version-matched CLI
manual — read it before any Herdr work the scripts below don't cover; probe command groups rather
than guessing flags. Below is only the earned delta.

- **Launch and prompt through the scripts in this skill's directory** (PowerShell, PS 5.1-safe,
  ASCII-only, warnings not throws so callers read exit codes):
  - `herdr-up.ps1 S CWD name:kind[:model] ...` — headless server + one workspace + one pane per
    agent; idempotent (reuses existing agents, recovers one stuck on a startup dialog). claude
    launches with `--dangerously-skip-permissions`; `:model` maps to `--model` (`opus`, `fable`).
    Prints name→pane; tell the user S and `herdr session attach S`.
  - `herdr-send.ps1 S NAME PROMPT_FILE` — one-hop delivery, verified to `working` (codex needs the
    nudge-enter; claude's first-launch notice eats prompt #1; blank lines are collapsed).
  - `herdr-wait.ps1 S NAME [TIMEOUT_MS]` — background it as the wake signal; its verdict is the
    agent's final status, not `agent wait`'s exit code. One watcher per agent; they are disposable
    (they die with your session), agents and report files are durable.
- **Agents inherit the workspace cwd**: one Herdr session per worktree (`sdk-w2` ↔
  `Pe.Revit.Sdk-w2`). Sibling worktrees are created from the CLI as repo siblings, each on its own
  branch; the orchestrator merges in dependency order and runs the deterministic harness after
  every merge. Stop the Herdr session before removing its worktree (the pane holds the directory).
  In the main checkout `.claude/skills/**` and `.agents/skills/**` are hardlinked (one edit shows in
  both); `git worktree add` checks out two independent files, so in a worktree edit both and `diff`
  them before committing.
- `--session S` on **every** command, never the default session or `--current`. Never drive slash
  commands through `send-text` from Git Bash (MSYS rewrites `/quit`); `agent prompt` owns `/`.
  IDs come from parsed JSON. One prompt owner per agent.
- Health: `agent list`. `idle|done` = complete; `blocked` = needs input; `unknown` proves nothing.
  A `blocked` agent on a harness safety prompt (e.g. the "possibly-empty variable" `rm` guard):
  read the pane; if the guard is a heuristic false positive on a path you can see, `send-keys
  <name> enter` accepts the highlighted default — never guess numeric options.
- Missions name a report file and end with "work autonomously; do not ask". Read the report AND
  spot-check the diff yourself before merging; a pasted proof is a claim until re-run. Time on task
  that felt wrong is signal — agents are told to say so, and you surface it.
- Urgent redirect: `send-keys <name> esc` → verify settled → re-prompt. Reads are terminal
  snapshots; if more `--lines` reveals nothing, have the agent write Markdown to disk.
- Dev servers / long tests: `pane run` → `pane wait-output --match <ready-line>` → `pane read`.
- Retain panes for the user; close only what this run created (`herdr session stop S`, then
  `session delete S`). Prompts execute with the pane agent's permissions — they are privileged.

## Timeouts, backgrounding, cleanup

- Revit operations are minutes-scale. The shell's default timeout silently overrides
  `--timeout-seconds`; set the client timeout ≥ the CLI timeout, or `--no-wait` + `session watch`.
  `doc open` takes no `--timeout-seconds` — background it and read `op result`.
  Never sleep-then-poll; read `session status` before any retry. Leases and quarantine: `test
  --unstick` owns reclaim; never hand process surgery.
- Never probe CLI surface through app-booting wrappers (`pnpm run pea -- --help` boots the app);
  never foreground a smoke suite to read three tail lines — background once, tee, poll.
- The permission sandbox can block localhost HTTP, indistinguishable from a dead host. Probe
  127.0.0.1 unsandboxed, or via the SDK surface.

## What to trust (exit codes lie here)

| Signal | Truth |
|---|---|
| exit 255 from a `pe-revit`/`pea` run | phantom: you truncated a native pipe mid-write (`Select-Object -First N`) or wrapped stderr. Tee to a file, then read |
| op `{ok:true}` empty payload | cross-check an independent source (dies when: `emptyBecause`, host ledger) |
| rg exit 1 | "no matches", a finding, not a failure |
| robocopy exit 0–7 | success tiers, only ≥8 is failure |
| herdr group help exit 2 / server errors exit 1 | help prints to stderr by design; errors are JSON on stderr |

Every `--json` envelope carries `diagnostics[{code,detail,fix}]` and `nextSteps[]`; branch on the
diagnostic `code` (never on exit 3 alone), follow `fix:` before inventing a remedy, and when a
prescribed fix fails once, diagnose — don't re-run the prescription. When `diagnostics` is empty
but the verdict is bad, read `result`: `doctor` exits 0 with `ok:false` checks, `test --attach`
nests the real code under `result.liveSync[0].json.diagnostics`, `install verify` puts the remedy
in `result.next`, and `install repair --release latest` can silently downgrade below
`product.payloads.json` (dies when: each lifts its failure to the top level, SDK). Windows shell-tax rules live
in `AGENTS.md`.

## Guardrails

- Never `Stop-Process`/`taskkill` Revit.exe by hand: `session stop|restart` (`--force` only after a
  verified stuck pid), `session gc`, and `test --unstick` own process lifecycle; the resolver
  refuses anything it cannot prove it controls. Preserve other worktrees' and installed sessions.
- Never treat an open document as implicit — `doc current`.
- Never infer freshness from an isolated build, an old log line, or a matching filename; the row's
  `buildStamp` and the emitter's `apply` event are the witnesses.
- Never use harness worktree tools; `git worktree add` as repo siblings, never nested.

## Reporting

Every proof claim names its lane and, for Revit, the session id and custody. For spatial/model
claims, images of the solver's actual inputs — a metric can rise while the render lies. Never
imply a model or file change happened without tool-confirmed evidence. Doctrine changes are scored
by `tools/loop-metrics.py` against the 2026-08 baseline.
