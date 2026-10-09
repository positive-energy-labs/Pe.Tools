---
name: execute
description: "How code runs and claims are proven in Pe.Tools. Trigger on \"run\", \"test\", \"build\", \"prove it\", \"which lane\", \"worktree\", \"herdr\", \"spin up\", \"dev server\", \"background this\", or before a Revit session, browser check, long process, or proof claim. Runbook, not a route; unexplained failures belong to `diagnose`."
figure: the proving ground and chain of custody — touch the right reality, then name exactly what answered
prevents: "the wrong reality: a claim proved on a lane that cannot falsify it"
scope: repo
---

# Execute

**Everything must be learned.** Pe.Tools tooling is deliberate and changes quickly. Doubt memory; read current repo commands, tool guides, and returned identity before action.

**Enter the proving ground.** A run proves only the bytes, process, state, and surface it touched. Climb to the cheapest lane that can falsify the claim. A higher lane is not better when it touches the wrong thing.

**Keep the chain of custody.** Name the checkout, commit, command, binary, session, and result that connect the claim to reality. If one link is inferred, the claim is unproven.

**Tooling failures are systemic signals.** One unexpected failure starts diagnosis. Do not retry until you know what changed. Repeated friction belongs in the substrate or a check before it becomes another paragraph here.

## Operating contract

- Name the claim and proof lane before the run. Report it as `PROVEN[lane, where, commit, when]`, `FALSIFIED[lane, what broke]`, or `UNPROVEN[why]`.
- Use an explicit working directory. Read the checkout and commit before a long or stateful run. Read the answering binary identity when a CLI exposes one.
- Preserve user and concurrent state. Stop only processes, panes, sessions, and servers this run created.
- Prefer the repo's command, then the tool's guide or help. Do not preserve a copied CLI manual here.
- Read `docs/ARCHITECTURE.md` and `docs/BUILD.md` before multi-package, build, deployment, or dev-loop changes.
- Use PowerShell. `AGENTS.md` owns Windows quoting and exit-code footguns.

## Stack

| Surface | Entrypoint |
|---|---|
| C# and Revit | `dotnet`; the checkout-pinned `pe-revit` tool |
| Host and web | VitePlus through the `vp` command or package scripts |
| Pea and host operations | `pea`, after verifying which checkout and host lane it resolved |
| Browser | the harness's in-app preview first |
| Agents | the harness Agent tool by default; `.agents/skills/slot.execute/herdr.ps1` only when the user must see or talk to the agent, the work needs its own thread to revisit, or one agent hands off to another |

## Proof lanes

| Lane | Proves | Does not prove |
|---|---|---|
| deterministic | pure behavior over controlled inputs | Revit, installed bytes, or browser behavior |
| compile | one checkout compiles | runtime behavior or deployment |
| artifact | the produced package or generated file has the inspected shape | installation or execution |
| fresh | a Revit-backed test in its own ephemeral controlled Revit | an existing durable session |
| attached | a test in a named existing controlled session | fresh boot or installed bytes |
| session | behavior in a named durable controlled Revit; name `dev` or `installed` payload | another session or payload lane |
| installed | product-root or MSI behavior | checkout bytes |
| browser | the rendered and interactive route the browser actually loaded | Revit mutation unless the route's receipt proves it |

HTTP, source inspection, screenshots, logs, and hot-reload verdicts are evidence inside a lane. None upgrades the lane by itself.

## Revit control plane

The SDK owns generic build, process, session, document, test, package, and install mechanics. Ask it instead of guessing:

```powershell
dotnet tool run pe-revit -- guide
dotnet tool run pe-revit -- guide session
dotnet tool run pe-revit -- guide test
dotnet tool run pe-revit -- <family> --help
dotnet tool run pe-revit -- <command> --json
```

- Run `test --plan` or `session start --plan` before first Revit contact in a checkout. `pe-revit test --project <P>` chooses deterministic or fresh from the project; `--attach --id <session>` chooses attached.
- `session list` is the machine census. It projects controlled rows from receipts and observed rows from exact Revit process identity. `--all` adds gone, failed, and unreadable evidence.
- `session start --quarantine` is the opt-in clean boot for Revit 2025.3+; it disables third-party add-ins only for that session and restores the native store when the session ends.
- Custody records acquisition. `controlled` means the SDK holds a registry row; an observed Revit answers reads through `--pid`, and its first targeted mutation adopts it. The SDK owns that guard.
- An agent's own Revit starts `--background`: `session start --background --id <name> --year <Y>`, or `doc open <file> --start --window headless` to start and open in one verb. Background cancels any dialog with no proved answer and fails the running op; a person's session keeps its dialogs.
- `pe-revit start`, `hr`, `open <source>`, and `stop` are the checkout's default forms. `--id <name>` names a session; `--pid <number>` names a process. The SDK resolves the checkout and year, then the single running session, and refuses ambiguity.
- `pe-revit hr` is the disposable development edit loop. Its hot or cold verdict proves delivery, not product behavior. Re-run the behavior. A cold swap discards unsaved edits and reopens all recoverable documents from a fresh checkpoint, including documents opened outside the CLI; never-saved documents are dropped and views are not restored. HR requires `shape.reload: hot`. Use other shapes for work that must survive.
- `doc list [--id <session>]` is the document census before acting (no `--id`: every live session; `--recent [--year <Y>]` needs no Revit). `doc open <file> --id <session> --window headless` opens, `doc save --doc <openId> [--out <F>]` saves, `doc close --doc <openId> --unsaved keep|discard` closes.
- `op run <key> --id <session> [--doc <openId>] [--body <file>]` runs an SDK or product op on the session's one queue and waits; `--no-wait` returns `running`. Then `op wait <requestId>`, `op cancel <requestId>`, and `op result <requestId>` (needs no Revit); `op list` tails the receipts.
- Every mutating verb takes `--request-id <uuid>` (your recovery handle), `--expect-session <receiptPath>|absent`, and `--expect-doc <openId>|absent|new`. Exit codes: 0 ok, 1 failed, timed-out, cancelled or abandoned, 2 bad invocation, 3 refused (never ran), 4 running or transport-lost (read the receipt).
- A wedged Revit ends with `session reset` (`--restart` relaunches and reopens recoverable documents from the available checkpoint), never a kill. `pe-revit stop` stops the resolved checkout session. Stop/reset/close default to keep for foreground checkout sessions; other shapes require `--unsaved keep|discard`. Discard is explicit except cold HR.
- Terminal `dotnet build` and `publish` are isolated compile or artifact lanes. Raw `dotnet test` is forbidden for Revit-backed projects.
- The MSI installs the product; `update check|apply` plans and applies product updates through the host's update route, and `doctor [--fix]` reports and repairs wiring.
- Never use `Stop-Process`, `taskkill`, or direct Revit launch. `pe-revit session` owns controlled Revit lifecycle. Never mutate installed product state without explicit authority.
- Opening a `.rvt` by file association joins whatever Revit is running, including an SDK snapshot session with add-ins quarantined. Never open a document for the person while `session list` shows a controlled session; the person launches their own Revit first. A delegated agent stops only the session id it started, and reports the person's Revit pid alive before and after (2026-09-25: a stopped snapshot took the person's unsaved work with it).

## Host, web, Pea, and browser

- `pnpm verify` from `ts` is the one proof of a change: workspace check, knip, every package's tests, then the repo guards, serialized, full output. Nothing else is a named proof entrypoint.
- Run host or web dev servers as background processes; use Herdr only when the user needs the pane. Ports are dynamic; read the service receipt under `%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\service\` instead of assuming one.
- The generated contract in `packages/host-contracts/src/vendor/generated/pe-revit-contract.ts` owns `pe-revit` argv and envelopes. Do not hand-write either.
- `pea` is checkout-pinned. Read the checkout and host URL it reports before treating its answer as evidence, especially from a worktree.
- Discover host operations before calling them. Put structured requests in a file; do not pass JSON through PowerShell quoting. A mutation script ends with an independent read-back.
- Show a picture to the person with a markdown image whose absolute path uses forward slashes: `![x](C:/Users/.../out.png)`. A backslash path does not render in the T3 chat (2026-09-26). Put the backslash path in a code block beside it for copying.
- Use the in-app browser preview for route proof. Inspect console, network, visible state, and the route's receipts. If browser automation is unavailable or broken, report the browser claim as unproven and prove only the lower lane.
- A measured browser claim (hover timing, layout shift, long tasks) needs a visible, un-throttled tab: a background tab pauses animation frames and throttles timers, so popovers never open under synthetic input and no shift or long-task entry is recorded. Launch the measuring Chrome with `chrome-agent launch --port <p> -- --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`. `chrome-agent stop` deletes that instance's session profile and its sign-in; the person signs in again, never you.
- More than a handful of CDP calls wants one persistent websocket to the target (chrome-agent's Python client, or `websockets` to `/json`'s debugger URL), not a CLI spawn per call: a spawn costs seconds, a call on an open session costs a millisecond. Hover everything before clicking anything, dwell past the popover delay, and abort a route when the page reloads or shows its crash screen. Any edit to the tree reloads the dev server and voids a run in progress.

## Worktrees and Herdr

- Create worktrees as sibling directories with `git worktree add`; never nest them.
- A fresh worktree has no dependency install. From `ts`, run `vp i --frozen-lockfile --prefer-offline`. Vite+ owns dependency installation; never use bare `pnpm install`.
- Fresh worktrees use the release feed at `%USERPROFILE%\source\feeds\pe-revit-sdk` or `sdk.feed` in `product.payloads.json`; `pe-revit sdk adopt <version>` repins and regenerates the client. Review `--plan` first. Do not copy, junction, or symlink a feed into the worktree.
- Bare `pe-revit` on PATH is the product shim. Run `dotnet tool run pe-revit -- dev link` once from any checkout so the shim's dev lane runs the pinned tool of whatever cwd you are in (SDK beta.163); `dotnet tool run pe-revit -- <verb>` is the same tool without the shim.
- Never `git stash` in a worktree. `refs/stash` is shared by every worktree of one repo; parallel lanes pop each other's work. Baseline with a throwaway worktree or `git diff > file`.
- Herdr is for agents and processes the user must see; otherwise it is ceremony (kaitpw, 2026-09-26). Herdr is PowerShell. Use one named Herdr session per worktree. Parse its returned session, workspace, tab, and pane IDs; never infer focus.
- Before first use, resolve `herdr` with `Get-Command herdr`. If it is absent, set `HERDR_BIN` to the executable or report the agent lane unavailable; do not retry the wrapper unchanged.

```powershell
& .\.agents\skills\slot.execute\herdr.ps1 up <session> <cwd> <posture.md> <name>:<kind>[:<model>][:<effort>]
& .\.agents\skills\slot.execute\herdr.ps1 cast <session> <cwd> <posture.md> <spec> <prompt-file>
& .\.agents\skills\slot.execute\herdr.ps1 goal <session> <goal.md>
& .\.agents\skills\slot.execute\herdr.ps1 retire-worktree <path>
& .\.agents\skills\slot.execute\herdr.ps1 sweep [<days>]
& .\.agents\skills\slot.execute\herdr.ps1 status <session> [<agent>]
& .\.agents\skills\slot.execute\herdr.ps1 send <session> <agent> <prompt-file>
& .\.agents\skills\slot.execute\herdr.ps1 wait <session> <agent> [<timeout-ms>]
& .\.agents\skills\slot.execute\herdr.ps1 read <session> <agent> [<lines>]
```

Do not retire a working agent. Keep long runs observable, read state before retrying, and stop only the Herdr session or pane this run created.

## Evidence

- Capture complete output before filtering it. Read JSON `diagnostics`, `result`, `nextSteps`, `related`, and `binary`; branch on diagnostic codes rather than one exit number.
- Treat a thin success as suspect until one independent witness agrees. A compile, `ready`, HTTP 200, or accepted hot reload can each hide a broken downstream surface.
- When state and output disagree, stop. Record both and enter `diagnose`; do not repair the discrepancy by assumption.

## Admitting new caveats

A caveat enters this file only when it changes a future execution choice and no code, check, tool guide, or `AGENTS.md` rule can own it. Put it at the decision point. Temporary caveats name the condition that deletes them. One-off incidents stay out.

## Skill-set check

After any skill edit, run `python .agents/skills/check.py`. `--fix` may repair the generated index table and skill junction; rerun without `--fix` for the verdict.
