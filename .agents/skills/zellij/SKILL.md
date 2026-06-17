---
name: zellij
description: Use Zellij as a visible terminal workspace for long-running commands, interactive CLIs, user-observable agent collaboration, pane/tab management, sending input to panes, reading pane output, or when the user asks to use zellij, panes, visible agents, terminal multiplexing, or collaborative terminal workflows.
---

# zellij

Use Zellij when work should stay visible, interruptible, or collaborative instead of disappearing into a hidden background process. Prefer it for long-running commands, interactive CLIs, REPLs, dev servers, watchers, and user-observable agent-to-agent conversations.

## Ground Rules

- Keep visibility first: run important interactive or long-lived work in named panes the user can see and control.
- Use raw `zellij action` commands. Do not invent wrapper semantics unless repeated use proves a small helper is needed.
- Capture pane IDs from `new-pane` output whenever later input or observation is likely.
- Name panes clearly with `--name`; report the pane name and ID when user observation matters.
- Do not infer completion just because input was sent. Completion is explicit only when the process exits, a known marker appears, the user confirms, or a target emits a separate done signal.
- Treat `dump-screen` as observation of rendered terminal output, not as a structured transcript or proof that a task is complete.
- In PowerShell, use the call operator `&` and variables for messages/paths to avoid quoting failures.

## Session Posture

Inside a Zellij session, `zellij action ...` targets the current session. Zellij exposes the current session and pane through environment variables:

```powershell
$env:ZELLIJ_SESSION_NAME
$env:ZELLIJ_PANE_ID
```

From outside a session, target a known session by placing `--session <name>` before `action`:

```powershell
& zellij --session $session action list-panes
```

Never hardcode a session name when `$env:ZELLIJ_SESSION_NAME` is available.

## Start Visible Work

Open a named pane and capture the returned ID. `new-pane` returns IDs like `terminal_3`.

```powershell
$cwd = (Get-Location).Path
$paneId = (& zellij action new-pane --direction right --cwd $cwd --name "worker" -- powershell -NoLogo).Trim()
```

Run a command directly as the pane process when no interactive shell is needed:

```powershell
$cwd = (Get-Location).Path
$paneId = (& zellij action new-pane --direction down --cwd $cwd --name "tests" -- pnpm test).Trim()
```

Open a new tab when the work needs more room:

```powershell
$cwd = (Get-Location).Path
$tabId = (& zellij action new-tab --cwd $cwd --name "investigation" -- powershell -NoLogo).Trim()
```

Useful `new-pane` options:

- `--direction right|down` for tiled splits.
- `--floating --width 80% --height 60%` for floating panes.
- `--cwd <path>` for working directory.
- `--name <name>` for visibility.
- `--block-until-exit`, `--block-until-exit-success`, or `--block-until-exit-failure` when the command is non-interactive and process exit is the desired completion signal.
- `--close-on-exit` only when the user does not need final output left visible.

## Send Input

For normal one-line TUI input, write characters and press Enter:

```powershell
$msg = 'hello from the visible zellij workflow'
& zellij action write-chars --pane-id $paneId $msg
& zellij action send-keys --pane-id $paneId Enter
```

For longer or multiline input, prefer bracketed paste, then submit if the target expects Enter:

```powershell
$msg = @'
Review this output.
Call out the next concrete step.
'@
& zellij action paste --pane-id $paneId $msg
& zellij action send-keys --pane-id $paneId Enter
```

To let the user review before submission, send or paste the text but do not press Enter. Then tell the user which pane contains the pending input.

```powershell
$msg = 'Draft prompt for review before submit'
& zellij action write-chars --pane-id $paneId $msg
```

Use `send-keys` for control keys:

```powershell
& zellij action send-keys --pane-id $paneId "Ctrl c"
& zellij action send-keys --pane-id $paneId Enter
```

## Observe Output

Dump the visible viewport:

```powershell
& zellij action dump-screen --pane-id $paneId
```

Dump full scrollback:

```powershell
& zellij action dump-screen --pane-id $paneId --full
```

Preserve ANSI styling or write to a file when useful:

```powershell
& zellij action dump-screen --pane-id $paneId --full --ansi
& zellij action dump-screen --pane-id $paneId --full --path $outputPath
```

For live observation, `zellij subscribe --pane-id <pane-id>` can stream rendered output. Prefer point-in-time `dump-screen` unless streaming is specifically useful.

## Inspect And Manage Panes

List panes:

```powershell
& zellij action list-panes
& zellij action list-panes --json --all --state --command --tab
```

Focus a pane for the user:

```powershell
& zellij action focus-pane-id $paneId
```

Rename or close a pane:

```powershell
& zellij action rename-pane --pane-id $paneId "better-name"
& zellij action close-pane --pane-id $paneId
```

Pane IDs may be written as `terminal_1`, `plugin_2`, or a bare number such as `3` for `terminal_3`. Store and reuse the exact ID returned by Zellij.

## Completion Semantics

Choose the weakest honest completion claim:

- `sent`: input was delivered and, if requested, Enter was sent.
- `observed`: output was dumped and contains the reported text.
- `process-exited`: a non-interactive pane command exited or `list-panes --json` reports an exited pane.
- `marker-seen`: a known done marker appears in dumped output.
- `probably-idle`: repeated observations were stable for a chosen interval.
- `user-confirmed`: the user inspected the pane and confirmed completion.

For non-interactive commands, prefer `new-pane --block-until-exit*` when the calling agent should wait on process exit.

For interactive agents and TUIs, do not rely on exit status. Use visible observation, explicit markers, user confirmation, or a separate side channel if the target provides one.

## Collaboration Pattern

1. Start or reuse a named visible pane.
2. Send one focused message.
3. Observe with `dump-screen` only when machine observation is needed.
4. Tell the user the pane name/ID and whether the status is `sent`, `observed`, or stronger.
5. Let the user intervene directly in the pane when judgement, review, or manual steering matters.

Prefer small turns. A visible pane is shared workspace, not a hidden subagent call.
