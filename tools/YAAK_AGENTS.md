# Yaak Agent Notes

This file records the mistakes an agent is likely to make when working with
Yaak from this repo on Windows.

## What Is In This Repo

- This repo does **not** contain the live Yaak workspace data by default.
- The repo only contains a bootstrap script:
  [yaak/bootstrap_pe_host_workspace.py](C:/Users/kaitp/source/repos/Pe.Tools/tools/yaak/bootstrap_pe_host_workspace.py)
- Running that script creates or updates a workspace in the user's Yaak data
  store.

## Default Yaak Storage On This Machine

- Workspace/config database:
  `C:\Users\kaitp\AppData\Roaming\app.yaak.desktop\db.sqlite`
- Blob store:
  `C:\Users\kaitp\AppData\Roaming\app.yaak.desktop\blobs.sqlite`
- Stored responses:
  `C:\Users\kaitp\AppData\Roaming\app.yaak.desktop\responses`
- App/runtime install:
  `C:\Users\kaitp\AppData\Local\Yaak`

Do not assume the workspace exists as a tracked file in the repo unless the
user has explicitly enabled Yaak Directory/Git Sync.

## Git Assumptions To Avoid

- Do not assume Yaak is Git-backed by default. Local SQLite storage is the
  default.
- Do not assume creating a workspace via `yaakcli` creates repo-visible files.
- If the user wants Git-friendly Yaak state, they need Yaak Directory/Git Sync
  or a deliberate export flow.

## CLI Assumptions To Avoid

- `yaakcli` can send saved requests, folders, and workspaces by ID.
- `yaakcli` does **not** let you address requests by friendly name directly.
- The agent usually needs to resolve IDs first via:
  - `yaakcli workspace list`
  - `yaakcli folder list <workspace_id>`
  - `yaakcli request list <workspace_id>`
  - `yaakcli environment list <workspace_id>`
- The workspace created for this repo is named `Pe.Host Endpoints`, but the
  Yaak IDs are not stable across machines or recreations.

## Windows Invocation Footguns

- Do not assume `yaakcli.cmd` is safe to wrap with `cmd /c` when JSON payloads
  or URLs contain `&`.
- On Windows, `cmd` can split a Yaak `--json` payload if the embedded request
  URL has query parameters.
- For scripted automation, prefer invoking the real `yaak.exe` binary directly
  through `subprocess.run([...])`.
- The bootstrap script already contains logic to locate the installed
  `yaak.exe`; reuse that pattern.

## JSON Update Footguns

- Do not assume PowerShell quoting will preserve raw JSON passed to
  `yaakcli ... update --json ...`.
- Passing JSON through shell interpolation was unreliable here.
- Prefer:
  - direct subprocess argv calls
  - `json.dumps(..., separators=(",", ":"))`
  - no shell parsing layer between Python and `yaak.exe`

## Request Body Assumptions To Avoid

- Do not assume seeded POST request bodies are required.
- In this repo's generated workspace, POST requests were intentionally created
  with empty bodies so humans can fill them in during testing.
- If an agent wants to send one of those saved POST requests, it must first
  populate the body in Yaak or update the request via CLI.

## Environment Assumptions To Avoid

- Each workspace has a `Global Variables` environment created by Yaak.
- For `Pe.Host Endpoints`, the bootstrap script seeds:
  - `base_url`
  - `module_key`
  - `root_key`
  - `route_key`
- Do not assume additional sub-environments exist unless you list them.

## Known Good Commands

- Rebuild or update the Pe.Host Yaak workspace:
  `python tools\yaak\bootstrap_pe_host_workspace.py`
- List workspaces:
  `yaakcli workspace list`
- List requests in the generated workspace:
  `yaakcli request list <workspace_id>`
- Send a saved request:
  `yaakcli request send <request_id>`
- Send a whole workspace:
  `yaakcli send <workspace_id>`

## Minimal Yaak API Surface Used Here

- `workspace list|show|create|update`
- `folder list|show|create|update`
- `environment list|show|update`
- `request list|show|create|update|send`
- `send <id>`

## Docs

- CLI usage:
  https://yaak.app/docs/getting-started/cli-usage
- Import/export:
  https://yaak.app/docs/collaboration/import-and-export-data
- Directory/Git Sync:
  https://yaak.app/fb-redirect/help/articles/6595769-local-directorygit-sync
