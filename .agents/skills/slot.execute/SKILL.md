---
name: execute
description: "How code runs and claims are proven in Pe.Tools. Trigger on \"run\", \"test\", \"build\", \"prove it\", \"which lane\", \"worktree\", \"herdr\", \"spin up\", \"dev server\", \"background this\", or before a Revit session, browser check, long process, or proof claim. Runbook, not a route; unexplained failures belong to `diagnose`."
figure: the proving ground and chain of custody — touch the right reality, then name exactly what answered
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
| Agents and long-lived processes | `.agents/skills/slot.execute/herdr.ps1` from PowerShell |

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
- Custody is authority. `controlled` means the SDK holds a receipt and may mutate the session. `observed` means read-only discovery; lifecycle and document mutations must refuse it.
- `session hr --id <session>` is the edit loop. Its hot or cold verdict proves delivery, not product behavior. Re-run the behavior.
- Use `doc current` before acting on a document. Use `op list`, `op status`, and `op result` to recover durable operation receipts after interruption.
- Terminal `dotnet build` and `publish` are isolated compile or artifact lanes. Raw `dotnet test` is forbidden for Revit-backed projects.
- `install status|converge|remove` is the install surface. `converge` is the only mutator and owns cleanup; self-update uses `install converge --release latest --json`.
- Never use `Stop-Process`, `taskkill`, or direct Revit launch. `pe-revit session` owns controlled Revit lifecycle. Never mutate installed product state without explicit authority.

## Host, web, Pea, and browser

- Run checks and tests through the owning package from `source/pe-tools`. Use `vp check --fix <paths>` once, then `vp check <paths>` once. A package name is not a check target.
- Run host or web dev servers in Herdr. Ports are dynamic; read the service receipt under `%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\service\` instead of assuming one.
- The generated contract in `packages/host-contracts/src/vendor/generated/pe-revit-contract.ts` owns `pe-revit` argv and envelopes. Do not hand-write either.
- `pea` is checkout-pinned. Read the checkout and host URL it reports before treating its answer as evidence, especially from a worktree.
- Discover host operations before calling them. Put structured requests in a file; do not pass JSON through PowerShell quoting. A mutation script ends with an independent read-back.
- Use the in-app browser preview for route proof. Inspect console, network, visible state, and the route's receipts. If browser automation is unavailable or broken, report the browser claim as unproven and prove only the lower lane.

## Worktrees and Herdr

- Create worktrees as sibling directories with `git worktree add`; never nest them.
- A fresh worktree has no dependency install. From `source/pe-tools`, run `vp i --frozen-lockfile --prefer-offline`. Vite+ owns dependency installation; never use bare `pnpm install`.
- Herdr is PowerShell. Use one named Herdr session per worktree. Parse its returned session, workspace, tab, and pane IDs; never infer focus.
- Before first use, resolve `herdr` with `Get-Command herdr`. If it is absent, set `HERDR_BIN` to the executable or report the agent lane unavailable; do not retry the wrapper unchanged.

```powershell
& .\.agents\skills\slot.execute\herdr.ps1 up <session> <cwd> <name>:<kind>[:<model>][:<effort>]
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
