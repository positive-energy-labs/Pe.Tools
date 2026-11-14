---
name: execute
description: "How code runs and claims are proven in Pe.Tools. Trigger on \"run\", \"test\", \"build\", \"prove it\", \"which lane\", \"worktree\", \"spin up\", \"dev server\", \"background this\", or before a Revit session, browser check, long process, or proof claim. Runbook, not a route; unexplained failures belong to `diagnose`."
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
- The shell is PowerShell. `AGENTS.md` Tooling Footguns holds the quoting and exit-code traps.
- A native claim (Revit, tray, installed host) runs through `tools/acceptance.py`, which does setup, probe, census and teardown. Dev setup is backend-only by default; add `--web` for browser proof. Read its docstring. Record its SDK calls as envelopes under the run's `ev/`.
- One agent owns a native FALSIFIED from diagnosis through fix to the native re-check, in one task. Splitting cause, fix and re-check across agents costs extra rounds. A run with standing roles splits it as their charters say.

## Stack

| Surface | Entrypoint |
|---|---|
| C# and Revit | `dotnet`; the checkout-pinned `pe-revit` tool |
| Host and web | VitePlus through the `vp` command or package scripts |
| Pea and host operations | `pea`, after you verify which checkout and host lane it resolved |
| Browser | `pea browser` (`@pe/browser`); the harness preview only to show the user a page |

**Subagents.** Use the harness Agent tool for work that returns as text, or that edits files inside this checkout, when the main agent does not wait on it. Use T3 `delegate_task` for work the main agent waits on, or work that needs its own worktree. `delegate` decides who gets the work. Never use Codex-native `spawn_agent` for work anyone waits on, because its children are invisible to T3 and `wait_agent` times out.

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

The SDK owns build, process, session, document, test, package and install mechanics. `dotnet tool run pe-revit -- guide [session|test]` is its manual, `<family> --help` gives flags, and `--json` gives the envelope.

- Run `test --plan` or `session start --plan` before the first Revit contact in a checkout.
- Never use `Stop-Process`, `taskkill`, or a direct Revit launch. `pe-revit session` owns the Revit lifecycle.
- Raw `dotnet test` is banned for Revit-backed projects, because it launches or reuses Revit itself. Terminal `dotnet build` and `publish` are safe beside a running session.
- An agent's own Revit starts in the background, so a dialog with no proved answer fails the op instead of waiting for a person. `guide session` gives the form.
- An HR verdict proves delivery, not behavior. Re-run the behavior after it. A cold swap discards unsaved edits, so use another session shape for work that must survive.
- Opening a `.rvt` by file association joins whatever Revit is running, including an SDK snapshot session with add-ins quarantined. Never open a document for the user while `session list` shows a controlled session. The user launches their own Revit first. A delegated agent stops only the session id it started, and reports the user's Revit pid alive before and after.
- Never mutate installed product state without the user's explicit authority.
- The generated `ts/packages/host-contracts/src/vendor/generated/pe-revit-contract.ts` owns `pe-revit` argv and envelopes. Do not hand-write either.
- A Revit-backed drive runs on its own controlled session, a disposable copy of the model, and an isolated product home (`PE_TOOLS_PRODUCT_HOME`), all named in its receipt. `pea script` against that session needs the same `PE_TOOLS_PRODUCT_HOME`, or it reports no running dev host.
- `--quarantine` boots Revit with third-party add-ins disabled, which about halves startup and cuts memory. The SDK gives it to one live session per Revit year, because it works by editing one per-user settings file that Revit itself rewrites at boot and at shutdown. A second quarantined `session start` of that year is refused with `session.quarantine-unavailable` until the first session's process exits, and `machine.py admit` does not see the lease.

## Host, web and Pea

Run pea scripts, host operations, or `pea --prompt` only after the SDK session is fresh, and only when product behavior is the proof target. Use Pea's own doors (`pe_find`, `pe_read`, `pe_do`, the Revit API docs) and the `pea --prompt` probe for black-box product feedback, never for reviewing repo source.

- `pnpm verify` from `ts` is the whole-workspace checkpoint and the CI command. Run it on the candidate for main or release and at substantial checkpoints selected by coupling and risk under `prove`. A child-worktree merge into an integration branch does not trigger it. During iteration, run the affected package check, a focused reproducer, or a bounded `pea browser` or Vitest user flow that can falsify the current claim.
- After a gate failure, diagnose it and rerun the failed stage. Rerun wider stages only when later changes or open failures invalidate their evidence. Keep the full output in an artifact, and bring into the conversation only the result that changes the decision.
- Record an unrelated failure with its owner and consequence. It does not expand the current task, and it stays in any readiness claim.
- Excuse a red as already on the base only after it fails on the current base tip. A test that runs near its timeout is a performance finding first, so profile it before you call it a flake or give it more time.
- A dependency install, an owner-config compile or a focused package test needs no grant, slot or queue. A heavy step (a full suite, a build, a codegen run, a Revit session, a host with a browser) first runs `python .agents/skills/slot.execute/machine.py admit <kind>` and starts on ADMIT, because the machine's memory is the one resource every thread shares and none can see. `admit` exits 0 only on ADMIT, so a script chains it and cannot run through a HOLD; a HOLD goes to the implementor in one line. A delegated child gets REFUSE for `suite` unless its brief names it the owner of one, and then it passes `--owns-suite`; a writing child never owns a suite. `machine.py --help` prints its kinds and the `run`, `who`, `stop` and `prune` verbs. A thread stops what its own checkout started, and a resource left running for another thread is handed over in a message that names it.
- The commit that changes a tracked generated artifact's source also regenerates the artifact. A check never regenerates a tracked file, because it would change the candidate it claims to verify. Delete the tracked artifact when the build can derive it.
- Write source files and patches with the edit tool or with git (`git diff --output`, `git apply`). Never use PowerShell `Set-Content`, `Out-File` or a pipe, because they add a BOM, CRLF or codepage bytes. Run a destructive step such as checkout or reset as its own command, after the check that guards it has passed.
- While the user's dev session runs from the root checkout, a fast-forward of main there rebuilds their dev server and merges over their edits. Land it when they ask or between sessions. Do not fast-forward over a path they modified.
- A resource hold names the rule it obeys, who set it, and the reading that trips it now. A hold from an earlier batch expires with that batch. A held thread asks the rule's owner in one line and waits at most ten minutes.
- Run host and web dev servers as background processes. Ports are dynamic, so read the service receipt under `%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\service\`.
- `pea` is checkout-pinned. Read the checkout and host URL it reports before you treat its answer as evidence, especially from a worktree.
- Discover host operations before you call them. Put a structured request in a file, never in PowerShell quoting. End a mutation script with an independent read-back.
- Before you tell the user a tool or account capability is absent, read the tool's own protocol and help. `.agents/skills/slot.execute/meter.py` reads the Claude and Codex usage meters and changes nothing.
- Show a picture to the user with a markdown image whose absolute path uses forward slashes, such as `![x](C:/Users/.../out.png)`, because a backslash path does not render in T3 chat. Put the backslash path in a code block beside it for copying.

## Browser

- Browser proof is `pea browser`, and `pea browser guide` is its manual: launch, headless measurement, the observer connection and cleanup.
- A scripted `element.click()`, a dispatched event, a store call or an endpoint never stands in for a UI step.
- The harness preview and T3 preview tools only show the user a page. Their timeouts are tool limits, not product findings. Computer Use is banned on this machine.
- A repeatable journey is a list of named actions under `ts/tests/e2e/`, played by `walk.ts`, and `f1-fans.ts` is the pattern. An action finds its control by role and name, draws each choice from the seed, and checks a rule instead of a remembered value. Run one from `ts` on a fresh tab against a real Revit session with `node --import jiti/register tests/e2e/<journey>.ts --seed <n>`. `--walk <n>` plays n actions picked at random by the seed in place of the fixed list. A green journey alone gates nothing, because the driver also explores by hand in every gate drive. One-off checks use the CLI verbs (`pea browser SESSION click|type|press|shot`). Inspect console, network and visible state. If no browser can be driven, stamp the browser claim UNPROVEN and prove only the lower lane.

## Worktrees

- Create a worktree as a sibling directory with `git worktree add`. Never nest one.
- A worktree is cut from a commit, so a tool or rule that is uncommitted in the launching checkout does not exist for the child, and neither does one on a branch its base has not merged. Commit it and merge it before the launch.
- A fresh worktree has no dependency install. From `ts`, run `vp i --frozen-lockfile --prefer-offline`. Vite+ owns dependency installation, so never run bare `pnpm install`.
- A fresh worktree uses the release feed at `%USERPROFILE%\source\feeds\pe-revit-sdk`, or `sdk.feed` in `product.payloads.json`. `pe-revit sdk adopt <version>` repins and regenerates the client. Review its `--plan` first. Do not copy, junction or symlink a feed into the worktree.

## Evidence

- Capture complete output before you filter it. Read JSON `diagnostics`, `result`, `nextSteps`, `related` and `binary`, and branch on diagnostic codes rather than one exit number.
- When state and output disagree, stop. Record both and enter `diagnose`. Do not repair the discrepancy by assumption.
