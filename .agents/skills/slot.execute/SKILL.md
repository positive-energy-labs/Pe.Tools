---
name: execute
description: "How code runs and claims are proven in Pe.Tools. Trigger on \"run\", \"test\", \"build\", \"prove it\", \"which lane\", \"worktree\", \"herdr\", \"spin up\", \"dev server\", \"background this\", or before a Revit session, browser check, long process, or proof claim. Runbook, not a route; unexplained failures belong to `diagnose`."
figure: the chain of custody, where every hand between claim and reality signs
prevents: "the wrong reality: a claim proved on a lane that cannot falsify it"
scope: repo
---

# Execute

**Keep the chain of custody.** Every hand between the claim and reality signs the log: the checkout, the commit, the command, the binary, the session and the result. You may not fill a gap in the log from memory or likelihood, because one unsigned hand makes the exhibit inadmissible, and you may not sign for a hand you did not watch.

## Before a run

- Name the claim and its lane before the run. Stamp the result in the format `prove` gives.
- Use an explicit working directory. Read the checkout and commit before a long or stateful run, and read the answering binary's identity when the CLI reports one.
- Prefer the repo's command, then the tool's own guide or `--help`. This file does not copy a CLI manual.
- Read `docs/ARCHITECTURE.md` and `docs/BUILD.md` before a multi-package, build, deployment or dev-loop change.
- The shell is PowerShell. `AGENTS.md` Tooling Footguns holds the quoting and exit-code traps.
- A native claim (Revit, tray, installed host) runs through `tools/acceptance.py`, which does setup, probe, census and teardown. Read its docstring. Record its SDK calls as envelopes under the run's `ev/`.
- One agent owns a native FALSIFIED from diagnosis through fix to the native re-check, in one task. Splitting cause, fix and re-check across agents costs extra rounds.

## Stack

| Surface | Entrypoint |
|---|---|
| C# and Revit | `dotnet`; the checkout-pinned `pe-revit` tool |
| Host and web | VitePlus through the `vp` command or package scripts |
| Pea and host operations | `pea`, after you verify which checkout and host lane it resolved |
| Browser | `pea browser` (`@pe/browser`); the harness preview only to show the user a page |
| Subagents | see the paragraph below |

**Subagents.** Use the harness Agent tool for work that returns as text, or that edits files inside this checkout, when the main agent does not wait on it. Use T3 `delegate_task` for work the main agent waits on, or work that needs its own worktree. Use `.agents/skills/slot.execute/herdr.ps1` only when the user must see or talk to the agent, the work needs its own thread to revisit, or one agent hands off to another. `delegate` decides who gets the work. Never use Codex-native `spawn_agent` for work anyone waits on, because its children are invisible to T3 and `wait_agent` times out.

## Proof lanes

| Lane | Proves | Does not prove |
|---|---|---|
| deterministic | pure behavior over controlled inputs | Revit, installed bytes, or browser behavior |
| compile | one checkout compiles | runtime behavior or deployment |
| artifact | the produced package or generated file has the inspected shape | installation or execution |
| fresh | a Revit-backed test in its own ephemeral controlled Revit | an existing durable session |
| attached | a test in a named existing controlled session | fresh boot or installed bytes |
| session | behavior in a named durable controlled Revit; name the `dev` or `installed` payload | another session or payload lane |
| installed | product-root or MSI behavior | checkout bytes |
| browser | the rendered and interactive route the browser actually loaded | Revit mutation, unless the route's receipt proves it |
| visual | what a rendered frame shows, labelled against real ids or tokens | behavior or data the frame did not draw |
| static decompile | what shipped code says | what that code does at runtime |

HTTP responses, source reads, screenshots, logs and hot-reload verdicts are evidence inside a lane. None of them raises the lane.

## Revit control plane

The SDK owns build, process, session, document, test, package and install mechanics. Ask it for verbs, flags and exit codes:

```powershell
dotnet tool run pe-revit -- guide
dotnet tool run pe-revit -- guide session
dotnet tool run pe-revit -- guide test
dotnet tool run pe-revit -- <family> --help
dotnet tool run pe-revit -- <command> --json
```

- Run `test --plan` or `session start --plan` before the first Revit contact in a checkout.
- Never use `Stop-Process`, `taskkill`, or a direct Revit launch. `pe-revit session` owns the Revit lifecycle. A wedged Revit ends with `session reset`, never a kill.
- Raw `dotnet test` is banned for Revit-backed projects, because it launches or reuses Revit itself. Terminal `dotnet build` and `publish` are safe beside a running session.
- An agent's own Revit starts in the background, so a dialog with no proved answer fails the op instead of waiting for a person. `guide session` gives the form.
- An HR verdict proves delivery, not behavior. Re-run the behavior after it. A cold swap discards unsaved edits, so use another session shape for work that must survive.
- Opening a `.rvt` by file association joins whatever Revit is running, including an SDK snapshot session with add-ins quarantined. Never open a document for the user while `session list` shows a controlled session. The user launches their own Revit first. A delegated agent stops only the session id it started, and reports the user's Revit pid alive before and after.
- Never mutate installed product state without the user's explicit authority.
- The generated `ts/packages/host-contracts/src/vendor/generated/pe-revit-contract.ts` owns `pe-revit` argv and envelopes. Do not hand-write either.
- A Revit-backed drive runs on its own controlled session, a disposable copy of the model, and an isolated product home (`PE_TOOLS_PRODUCT_HOME`), all named in its receipt. `pea script` against that session needs the same `PE_TOOLS_PRODUCT_HOME`, or it reports no running dev host.

## Host, web and Pea

Run pea scripts, host operations, or `pea --prompt` only after the SDK session is fresh, and only when product behavior is the proof target. Use Pea's own doors (`pe_find`, `pe_read`, `pe_do`, the Revit API docs) and the `pea --prompt` probe for black-box product feedback, never for reviewing repo source.

- `pnpm verify` from `ts` is the whole-workspace checkpoint and the CI command. Run it before a worktree merge or a release, and after a large batch of messy changes. Do not run it after every edit. During iteration, run the affected package check, a focused reproducer, or a bounded `pea browser` or Vitest user flow that can falsify the current claim.
- After a gate failure, diagnose it and rerun the failed stage. Rerun wider stages only when later changes or open failures invalidate their evidence. Keep the full output in an artifact, and bring into the conversation only the result that changes the decision.
- Record an unrelated failure with its owner and consequence. It does not expand the current task, and it stays in any readiness claim.
- A keepalive is `python .agents/skills/slot.execute/keepalive.py arm [minutes]`, run once at launch (default 45 for every thread, controller included). One T3 automation, "Keepalive tick" on its own Haiku thread, runs `keepalive.py tick` every ten minutes and sends a wake through `t3 thread send` to any enrolled thread whose last run ended longer ago than its cadence, so a wake lands 45 to 55 minutes after the last run and inside the 60-minute prompt cache. Pause or delete that automation in T3 to stop every keepalive. `disarm` at retirement, and the tick disarms a thread whose only input for 16 hours was wakes, which is where keeping it warm starts to cost more than one cold start.
- A dependency install, an owner-config compile or a focused package test needs no grant, slot or queue. A thread runs them when its source is ready. A heavy step (a full suite, a build, a Revit session, a host with a browser) first runs `python .agents/skills/slot.execute/machine.py admit <kind>` and starts on ADMIT. A delegated child gets REFUSE for `suite`, because the full suite runs once per wave, on the merged tip. Before it answers HOLD for memory, `admit` stops every editor and bystander app (Zed, VS Code, ChatGPT, Edge, a Chrome that is not Helium) and reads again, because while a run is on most of the machine is killable and Helium is the one app that stays up; `machine.py prune --dry` lists what that would stop. A HOLD names the reading, the floor and the biggest stoppable holders; it expires after ten minutes and goes to the controller in one line. A driver whose Revit session is already up asks for `browser`, not `revit-drive`, because the drive floor pays for a cold Revit. `machine.py who` lists every process the repo's work can attribute, with its kind, checkout, age, memory and command line, so a thread can decide what to stop. `machine.py stop <pid>` stops a dev server, test worker, codegen, build server or agent browser and writes a receipt to `.artifacts/machine/stops.jsonl`; it refuses Revit, the installed product host, T3, Claude, Codex, Helium and any process it cannot name. Stopping a dev server is encouraged: they accumulate and their memory grows with the kernel. A thread stops what its own checkout started; the purger stops anything the run can attribute.
- The commit that changes a tracked generated artifact's source also regenerates the artifact. A check never regenerates a tracked file, because it would change the candidate it claims to verify. Delete the tracked artifact when the build can derive it.
- Write source files and patches with the edit tool or with git (`git diff --output`, `git apply`). Never use PowerShell `Set-Content`, `Out-File` or a pipe, because they add a BOM, CRLF or codepage bytes. Run a destructive step such as checkout or reset as its own command, after the check that guards it has passed.
- Send a message that unblocks a running turn as a steer. Queue only what can wait for that turn to end.
- While the user's dev session runs from the root checkout, a fast-forward of main there rebuilds their dev server and merges over their edits. Land it when they ask or between sessions. Do not fast-forward over a path they modified.
- A resource hold names the rule it obeys, who set it, and the reading that trips it now. A hold from an earlier batch expires with that batch. A held thread asks the rule's owner in one line and waits at most ten minutes.
- Run host and web dev servers as background processes. Ports are dynamic, so read the service receipt under `%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\service\`.
- `pea` is checkout-pinned. Read the checkout and host URL it reports before you treat its answer as evidence, especially from a worktree.
- Discover host operations before you call them. Put a structured request in a file, never in PowerShell quoting. End a mutation script with an independent read-back.
- Pea's `revit_docs_search` tool (`ts/packages/mcps/src/shared/autodesk-docs/`) searches the Revit platform record. Use sources `help` and `blog` first. `help` covers the newest Revit year. `prove` says when a claim must cite it.
- Before you tell the user a tool or account capability is absent, read the tool's own protocol and help. `.agents/skills/slot.execute/meter.py` reads the Claude and Codex usage meters and changes nothing. Redeem a reset credit (`account/rateLimitResetCredit/consume`, with a fresh idempotency key) only on the user's rule.
- Show a picture to the user with a markdown image whose absolute path uses forward slashes, such as `![x](C:/Users/.../out.png)`, because a backslash path does not render in T3 chat. Put the backslash path in a code block beside it for copying.

## Browser

- Browser proof is `pea browser`. The `pea` shim puts it on PATH, but `pe-browser` is not on PATH. `pea browser guide` prints its manual without starting anything. It owns its Chrome (headless or `--visible`), leases one tab, records receipts and retires what it started.
- Its gestures find the control by role and name on every call, hit-test the point before pressing, and read typed values back. A covered, disabled or mistyped control returns `blocked` or `mismatch`. Only these gestures prove what a user can do.
- A scripted `element.click()`, a dispatched event, a store call or an endpoint never stands in for a UI step.
- The harness preview and T3 preview tools only show the user a page. Their timeouts are tool limits, not product findings. Computer Use is banned on this machine.
- A repeatable journey is a typed program under `ts/tests/e2e/` (`journey()` from `cdp.ts`, beside `j1` to `j5`). Run one from `ts` with `node tests/e2e/<j>.ts`. One-off checks use the CLI verbs (`pea browser SESSION click|type|press|shot`). Inspect console, network and visible state. If no browser can be driven, stamp the browser claim UNPROVEN and prove only the lower lane.
- Drive and measure in the default headless launch (hover timing, layout shift, long tasks included). It has no OS window, so the owner's screen cannot cover or stall it, and it draws frames at full rate. `--visible` is for a person watching; minimizing any window stops its frames.
- Keep one observer connection for the whole run and write captured bodies to a file, because a CLI spawn per call costs seconds. `delegate` sequences edits around a measuring run.

## Worktrees and Herdr

- Create a worktree as a sibling directory with `git worktree add`. Never nest one.
- A fresh worktree has no dependency install. From `ts`, run `vp i --frozen-lockfile --prefer-offline`. Vite+ owns dependency installation, so never run bare `pnpm install`.
- A fresh worktree uses the release feed at `%USERPROFILE%\source\feeds\pe-revit-sdk`, or `sdk.feed` in `product.payloads.json`. `pe-revit sdk adopt <version>` repins and regenerates the client. Review its `--plan` first. Do not copy, junction or symlink a feed into the worktree.
- Bare `pe-revit` on PATH is the product shim. Run `dotnet tool run pe-revit -- dev link` once from any checkout, so the shim's dev lane runs the pinned tool of the current directory. `dotnet tool run pe-revit -- <verb>` is the same tool without the shim.
- Herdr is for agents and processes the user must see. Otherwise it is overhead. Herdr is PowerShell. Use one named Herdr session per worktree. Parse the session, workspace, tab and pane ids it returns, and never infer focus.
- Before first use, resolve `herdr` with `Get-Command herdr`. If it is absent, set `HERDR_BIN` to the executable or report the agent lane unavailable.

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

Do not retire a working agent.

## Skill set

The skill set checks itself: `python .agents/skills/check.py` from the repo root, `--fix` to reproject the tables and reinstall the junction and the commit hook. `reflect` says when it must run.

## Evidence

- Capture complete output before you filter it. Read JSON `diagnostics`, `result`, `nextSteps`, `related` and `binary`, and branch on diagnostic codes rather than one exit number.
- When state and output disagree, stop. Record both and enter `diagnose`. Do not repair the discrepancy by assumption.

## Admitting new caveats

A caveat enters this file only when it changes a future execution choice and no code, check, tool guide or `AGENTS.md` rule can hold it. Put it at the decision point. A temporary caveat names the condition that deletes it. One-off incidents stay out.
