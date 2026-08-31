---
name: execute
description: "How anything runs or is proven in this repo. Trigger on \"run\", \"test\", \"build\", \"prove it\", \"which lane\", \"worktree\", \"herdr\", \"spin up\", \"dev server\", \"background this\", \"why does pe-revit hang\", or before any subagent launch, Revit session, browser check, or proof claim. Runbook, not a stance. Lanes: deterministic, compile, artifact, pe-revit ladder (deterministic/fresh/attached), Revit sessions (dev/installed), documents, op receipts, host/web (vp), browser, worktrees, Herdr."
figure: how anything runs and is proven, this repo
scope: repo
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
  `binary{origin,assembly,sha256,informationalVersion}` (`origin: checkout | dev-installed |
  installed-global | unknown`) and the repo it ruled from in `command{cwd,commandRoot,commandRule,
  commandManifest}` — read both before believing an odd answer, especially from a worktree.
- **`pea` is checkout-pinned, not worktree-safe**: its dev shim routes to the main checkout and
  discloses the target; from a worktree treat `pea` results as evidence about the tree it names.
- **Custody**: the resolver refuses every mutation on an `observed` Revit; you never need to guard
  it yourself. The user's own Revit is observed unless they started it through `pe-revit`. Once a
  controlled session is yours, restarts and document opens are yours too — do them, don't hand back.
  If SDK output, machine state, and your expectations misalign: STOP and let the user reconcile.
- Preflight before any mutation: `session list --json` (`--id N` for one row, `--all` to include
  stopped/failed/missing). A row carries `id, phase, detail, origin, year, project, worktree,
  payload ("checkout"|"installed"), generationId, generationRoot, buildStamp, pid,
  processStartUtc, revitExecutable, receiptPath, overridePath, failure, observedAtUtc` — no
  custody field, because every registry row IS controlled; an observed (user-launched) Revit does
  not appear in `session list` at all — the host bridge is the only census of those.
  **`ready` means the SDK bridge answered, not that the product loaded**: `session logs --id N`
  is the only witness for `LoaderStartupFailed Pe.App` (dies when: start/list surface loader
  failures as diagnostics, SDK).
- Preflight the boundary too: explicit workdir on every compound command; prove a guessed path with
  `rg --files -g <pattern>` before building on it.

## Proof lanes, in preference order

1. **deterministic**, no Revit. Tests are temporary feedback, not a suite: one red loop while building, one deterministic run over the whole chain when it closes, the rest deleted. `pe-revit test --project <P>` picks this rung by itself for a
   year-neutral project. Put judgment here; spend Revit time only on proof.
2. **fresh**, the default Revit-backed proof: `pe-revit test --project <RevitTests csproj>` picks
   it for a Revit-backed project and launches its own ephemeral **controlled** Revit
   (`origin: test`, visible in `session list --all`). Grind: `test --plan` after any lane change →
   edit → `test --filter "Name~<OneTest>" --no-build` → repeat. `--configuration` and `--unstick`
   left the surface at beta.131; year selection is `--year` only (or the project's
   `PeDefaultRevitYear`). Parameterize probes via env vars (`$env:PE_RHVAC_MODEL=...`) instead of
   new flags.
3. **attached**, against a controlled session you name: `test --attach --id <session>`; it
   converges that session first (`--no-build` skips the converge). Static refusals are immediate
   and typed (`test.attach-preflight`).
4. **installed**: `install repair` runs the ladder and reports which rung fixed it; then a bare
   `session start --year Y` (no `--project`) runs the installed payload under a controlled id.
   `install apply` also deploys the SDK session bridge beside the bootstrap: a content-hash dir
   (`Addins\{year}\Pe.Revit.Bridge\{hash}\`) plus a `Pe.Revit.Bridge.addin` flip to it. After
   ANOTHER repo's `install apply` touched the shared installed product (e.g. the SDK's own live
   drive), this checkout's `install verify` goes red on hash mismatches; its `fix:` (`install
   apply --force`) is the supported reconcile.

`--plan` on `test` and `session start` prints the chosen rung/legs and the exact commands without
running them — use it before every Revit-contacting run in a new worktree.

**Terminal `dotnet build`/`publish` are SAFE beside a running session** (isolated lane → `.artifacts/`,
deploy/launch refused). A running session holds no lock on your tree: the emitter baselines the
generation copy, so `dotnet build` succeeds while it watches. **Raw `dotnet test` is banned for
Revit-backed projects** — it drives its own Revit outside the SDK's lifecycle and quarantine.

## Sessions and hot reload

One noun, five verbs since beta.131: `start`, `list`, `hr`, `stop`, `logs`. The retired words —
`session status` (→ `list --id`), `session restart` (→ `hr --restart`), `session converge`,
`session watch`, `session gc`, `protocol-server` — no longer parse; do not type them.

`session start --project <P> --year Y [--id N] [--doc <path|recent:T>] [--plan]
[--timeout-seconds S]` builds once, byte-copies into an immutable generation under
`%LOCALAPPDATA%\Pe.Revit.Sdk\sessions\{id}\generations\`, launches Revit, and blocks to SDK-ready
(minutes cold; there is no `--no-wait` — size the timeout instead). Without `--project` the
session runs the installed payload. Ids are minted `{project-stem|installed}-{yy}` from the main
checkout and `{stem}-{yy}-{worktree-dir}` from a worktree, so worktree sessions never collide
with main's; pass `--id` only for several sessions of one project+year. States are typed:
start answers `booting | doc-failed | existing | failed | gone | planned | ready | unresponsive`;
a start on an existing id answers `existing` rather than colliding.

`session hr --id N` is the whole edit loop: it applies your latest saved edit to the running
Revit, hot (EnC delta, keeps the pid, answer `hot-apply`) when the payload and year allow it,
else cold (restart + reopen the active document, answer `cold-swap`; its result lists `reopened`
and `dropped`). `--restart` skips the hot attempt. A rude edit surfaces
`session.restart-required`; a compile error blocks hr — fix and re-run, never restart for it.

Evidence gradient, weakest to strongest: compile < `hr` verdict < changed behavior. `hot-apply`
proves delta acceptance, not product behavior; re-run the behavior before claiming a reload
landed. Which edits hot-reload vs require restart is SDK truth (`docs/HOT_RELOAD.md` in
Pe.Revit.Sdk). Unsigned-addin approval is an always-on start leg, not a verb you type.
`session stop --id N` (`--force` only after a verified stuck pid) is the only retirement verb
left; stopped rows stay visible under `session list --all`.

## Documents and op receipts

Documents are session state: `doc open <path|recent:T> [--detach] [--conflict-policy
keep|discard-latest] --id N` (conflict-policy is REQUIRED for a cloud open; there is no `--year`
on open), `doc current [--doc T|P]`, `doc close --intent keep|discard [--doc T|P]` (default: the
active document; closing the active one hands activation to another open document first;
`--sync` is a cloud write and is refused — synchronize and relinquish stay user actions),
`doc recents [--year Y]` (Revit's own list, no bridge). `session start --doc` opens on boot; a
failed open answers state `doc-failed` and leaves a RUNNING session. Every mutating bridge op
journals a receipt before it answers: if your shell died mid-op, `op list --id N [--tail]` then
`op result <requestId>` recovers the answer; `op status <key> --id N` reads by op key. Never
infer an open document — read `doc current`.

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
  `LoaderStartupFailed` and the first op kills the bridge; `install list` names the culprit.
  Companion-leg narration left the CLI with `session status` (beta.131): `session start`/`hr`
  results still carry `legs[]`, but no list verb narrates the host leg — the service file and
  `GET /sessions` on the host are the leg witnesses now. Never assume 5180. Dev and installed
  hosts are SIBLINGS —
  a dev host never evicts the installed `host`, so this pane survives a session start through the
  route, and every client picks its host BY LANE: `--host dev | installed | <worktree path> | <url>`.
- The host relays session lifecycle for the browser at `GET /sessions` and `POST /sessions
  {action: start|stop|restart, id?, year?, doc?}` — the SDK envelope passed through untouched
  (`restart` shells `session hr --restart`). `start` takes `lane: installed` (default, the bare
  CLI meaning) or `dev` (this checkout's Pe.App; 400 on a host with no checkout).
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

### Variant rounds (`protoui` mechanics)

**Mounting.**

Prefer an existing host page. Variants render on the same route, gated by `?variant=`; data fetching, params, and auth stay, only the rendered subtree swaps. A throwaway route (project routing conventions, named `prototype-*`) is a last resort; an empty route hides problems a populated one exposes.

```tsx
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

Shared `<Header>` fine; shared `<Layout>` defeats the point.

**Switcher bar.**

Fixed *bottom-centre*, *constant-width* pill: ← arrow, `B — Sidebar layout` label, → arrow, wrapping. Arrows update the URL param via the router (shareable, reload-stable). Arrow keys cycle too, except when an input, textarea, or contenteditable is focused. Visually alien to the page so it reads as not-the-design. Gated out of production builds. One shared component, with the project's shared UI.

**Isolated HTML variants.**

For component-ey questions (a widget, an idiom, an interaction in isolation): one file, no framework, no server, opens by double-click, survives being emailed. Domain language on every label. Title and one-line question at top, variants side by side or tabbed. Real logic in a pure `<script>` module the page calls into; the shell is throwaway.

**Cleanup.**

Winner folds into canon, rewritten to prod standard. Losers, switcher, and throwaway routes leave main; the full round only kept on a throwaway branch if the user's verdicts lacked confidence.

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

Headless fallback that beat the preview tool on 2026-08-25 (the tool wedged on a worktree host: `snapshot`, `evaluate`, even `1+1` timed out while the app was healthy): `playwright-core` is already installed (`node_modules/.pnpm/playwright-core@*`) and drives the machine's Chrome by `executablePath`; import it by absolute `file:///` URL, no install. Recipes live at `.artifacts/runs/cutover-dev-20260825-b/probe*.mjs`: `probe.mjs URL` (alive check, iframe count, `__PE_INSPECT__` node count, body text, console errors), `probe-verb.mjs URL "text=<verb>"…` (click, then dump text + inspector changes), `probe-chat.mjs` (inputs + wire census). Text and `__PE_INSPECT__.inspect()` are the testimony; there is no screenshot in this lane. Cross-check the host pane log and the thread transcript (`/chat?thread=`): a pane receipt can say `opened` while the host refused the write.

`herdr.ps1 up` splits from `panes[0]`; when that pane runs the dev server it fails `agent_pane_busy` and never starts the agent. Until fixed: `pane split <a shell pane> --direction down --cwd <wt> --no-focus`, then `agent start <name> --kind codex --pane <id>`, then `herdr.ps1 send`.

## Herdr, subagents and observable background work

Herdr is tmux with agent-aware panes: it knows each agent's status, delivers prompts, emits notifications, and binds a workspace to a directory. Model: **session → workspace → tab → pane**; an agent is a process in a pane with `idle | working | blocked | done | unknown`. Always name the session; parse JSON and IDs; never infer focus.

Why here and never the harness Agent tool: **observability**, the user attaches to the same session, watches any pane, interjects; harness subagents are invisible and their waiters died on interrupt while Herdr panes survived. **Collaboration**, one prompt owner per agent, the user and orchestrator share the same durable panes, reports go to named files (pane history collapses on alternate-screen agents; a Markdown report is the record). **Background work**, dev servers, long tests, and overnight loops outlive the orchestrator's session; waiters are disposable wake signals, panes and report files are durable. Never close a working agent ("catch you killing a claude that was still running"); redirect with `esc`, wait, re-prompt.

One script, seven verbs, `herdr.ps1` beside this file (PowerShell 5.1, ASCII, warnings not throws, exit codes below). It carries the defenses the 2026-08 friction census demanded (69 instances, 26 session targeting, 15 liveness, 18 from the old `herdr-up.ps1`): resolved-cwd proof after launch, refusal of non-startup dialogs, parsed status, status-aware reads, idempotent stop.

```
herdr.ps1 up     S CWD name:kind[:model][:effort] ...  0 ready | 1 runtime | 2 usage | 3 blocked
herdr.ps1 send   S AGENT PROMPT_FILE           0 turn observed | 1 failed | 2 usage | 3 busy
herdr.ps1 status S [AGENT]                     parsed JSON
herdr.ps1 wait   S AGENT [TIMEOUT_MS]          0 settled (idle/done/blocked) | 1 timeout | 2 missing
herdr.ps1 read   S AGENT [LINES]               visible while working, recent-unwrapped when settled
herdr.ps1 retire S AGENT                       0 pane closed | 2 usage | 3 working (refused)
herdr.ps1 stop   S                             stop then delete; absent is success
```

- `up` is idempotent: an existing agent is reported, never restarted; a startup `launch_pending` dialog gets Enter, any other `blocked` is refused (exit 3). Agent names: lowercase, digits, `-`, `_`.
- Spec fields are positional and either may be empty (`name:claude::high`). Claude gets `--model`, `--effort`, and `--dangerously-skip-permissions`; codex gets `-m` and `-c model_reasoning_effort=`; any other kind refuses both (exit 2). Effort is one of low, medium, high, xhigh, max, ultra. Choose the pair per apostle from `delegate`'s `MODELS.md`; a mixed-model slate is a fan-out design decision, not a default.
- `retire` closes one agent's pane and refuses a `working` one (exit 3), which is how "never close a working agent" is enforced. It is the only way to correct a wrong `--model`/`--effort`, because `up` will never restart an agent that already exists: `retire`, then `up` with the right spec.
- `send` refuses an unsettled agent (one prompt owner), verifies the turn by `state_change_seq`, nudges Enter once for Codex's pasted-content case. Slash commands go through `agent prompt`, never `send-text` from Git Bash (MSYS rewrites `/`). Keys are logical: `ctrl+c`, `esc`, `enter`.
- `wait` is the wake signal: background it; its verdict is the parsed final status, not `agent wait`'s exit code. One waiter per agent.
- Agents inherit the workspace cwd: one session per worktree (`sdk-w2` ↔ `Pe.Revit.Sdk-w2`); stop the session before removing its worktree. In the main checkout `.claude/skills/**` and `.agents/skills/**` are mirrored; in a worktree edit both.
- Missions name a report file and end with "work autonomously; do not ask". Read the report AND spot-check the diff; a pasted proof is a claim until re-run. Time on task that felt wrong is signal.
- Dev servers / long tests: `pane run` → `pane wait-output --match <ready-line>` → `pane read`. Retain panes for the user; `stop` only what this run created. Prompts run with the pane agent's permissions; they are privileged.
- `herdr --skill` is the version-matched manual for anything the verbs don't cover; probe command groups, don't guess flags. Group help exits 2 on stderr by design.

## Timeouts, backgrounding, cleanup

- Revit operations are minutes-scale. The shell's default timeout silently overrides
  `--timeout-seconds`; set the client timeout ≥ the CLI timeout, or background the command and
  read the envelope from a tee file. `doc open` takes no `--timeout-seconds` — background it and
  read `op result`. Never sleep-then-poll; read `session list` before any retry. Never hand
  process surgery: `session stop --force` after a verified stuck pid is the whole toolkit
  (`test --unstick` left the surface at beta.131).
- Never probe CLI surface through app-booting wrappers (`pnpm run pea -- --help` boots the app);
  never foreground a smoke suite to read three tail lines — background once, tee, poll.
- The permission sandbox can block localhost HTTP, indistinguishable from a dead host. Probe
  127.0.0.1 unsandboxed, or via the SDK surface. **`vp dev` binds `[::1]` only** — a
  127.0.0.1 probe of a healthy web dev server refuses the connection and reads exactly like a
  dead host. Use `localhost` (or `[::1]`); confirm with `netstat -ano | Select-String ":<port>\s"`
  before believing a web server is down.
- `pane send-text` mangles a compound `$env:X="..."; cmd` line — the assignment can vanish and
  the process starts without it, silently. Set env inside the command the pane runs, or verify
  the value from the server's own output before trusting it.

## What to trust (exit codes lie here)

| Signal | Truth |
|---|---|
| exit 255 from a `pe-revit`/`pea` run | phantom: you truncated a native pipe mid-write (`Select-Object -First N`) or wrapped stderr. Tee to a file, then read |
| op `{ok:true}` empty payload | cross-check an independent source (dies when: `emptyBecause`, host ledger) |
| rg exit 1 | "no matches", a finding, not a failure |
| robocopy exit 0–7 | success tiers, only ≥8 is failure |
| herdr group help exit 2 / server errors exit 1 | help prints to stderr by design; errors are JSON on stderr |

Every `--json` envelope carries `diagnostics[{code,detail,fix}]`, `nextSteps[]`, `related[]`, and
`guide`; branch on the diagnostic `code` (never on exit 3 alone), follow `fix:` before inventing
a remedy, and when a prescribed fix fails once, diagnose — don't re-run the prescription. When
`diagnostics` is empty but the verdict is bad, read `result`: `install apply` answers `ok:false`
exit 1 with EMPTY diagnostics when its integrity write fails, burying the only clue in
`result.actions[].Status` — run `install verify` to get the coded diagnostics (proven
2026-08-30, beta.131). `install repair --release latest` can silently downgrade below
`product.payloads.json` (dies when: each lifts its failure to the top level, SDK). Windows
shell-tax rules live in `AGENTS.md`.

## Skill-set check

`python .agents/skills/check.py [--fix]`, deterministic lane, no deps. It asserts: every directory is `<kind>.<name>` with kind in root/lens/pass/slot/loop; frontmatter `name` equals the directory suffix, every skill has `figure`, every pass and loop has `stop`, every slot has `scope: skills|repo`; no trigger phrase is claimed by two skills; `root.index`'s table equals the projection of those fields; no skill carries a `## Parlance` section (aliases live in the Lexicon); no non-`slot.` stance names this repo, its tools, its paths, or carries a code fence; `.claude/skills` is a junction to `.agents/skills`, never a copy; and `~/.claude/skills` is empty (one home). `--fix` creates the junction and rewrites the table. Run it after any skill edit.

## Guardrails

- Never `Stop-Process`/`taskkill` Revit.exe by hand: `session stop` (`--force` only after a
  verified stuck pid) and `session hr` own process lifecycle; the resolver refuses anything it
  cannot prove it controls. Preserve other worktrees' and installed sessions.
- Never treat an open document as implicit — `doc current`.
- Never infer freshness from an isolated build, an old log line, or a matching filename; the row's
  `buildStamp` and `session hr`'s own verdict are the witnesses.
- Never use harness worktree tools; `git worktree add` as repo siblings, never nested.
- A fresh worktree has no `node_modules` and `pnpm install` there is banned. `wire-worktree.ps1 <worktree> [<source>]` beside `herdr.ps1` builds it: per-entry junctions to a healthy checkout (main when its install is whole, else `Pe.Tools-tooling-boot`) for `source/pe-tools` and every `apps/*`, `packages/*`, with workspace links (`@pe/*`) re-pointed at THIS worktree's tree. A single junction of the whole `node_modules` proves the wrong tree (2026-08-25). Proof of the link: `(Get-Item apps/web/node_modules/@pe/agent-contracts).Target` is inside the worktree and tsc exits 0 from `apps/web`. In a wired worktree `pnpm exec` runs a deps check that tries to install and aborts; use `pnpm --config.verify-deps-before-run=false exec <cmd>` or `node_modules/.bin/<cmd>`.
- After a merge that moves `pnpm-lock.yaml`, a checkout's install can drift while `pnpm install --frozen-lockfile` and `--force` both print "Already up to date": `node_modules/.modules.yaml` still names the old graph and the deterministic lane goes red on phantom failures (main @ `bf3473f`, 2026-08-27: 28 web tests, green in a sibling worktree at the same commit). Diagnose with `grep <expected-version> node_modules/.modules.yaml`; repair with `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install --frozen-lockfile`. A red lane in one checkout and green in another at one commit is install drift until proven otherwise.

## Reporting

Every proof claim names its lane and, for Revit, the session id and custody. For spatial/model
claims, images of the solver's actual inputs — a metric can rise while the render lies. Never
imply a model or file change happened without tool-confirmed evidence. Doctrine changes are scored
by `tools/loop-metrics.py` against the 2026-08 baseline.
