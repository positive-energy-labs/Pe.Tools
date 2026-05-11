# Revit Scripting First Probe

Short saved context for an agent starting from zero and trying to use the live Revit scripting lane quickly.

## First Working Loop

1. ensure `Pe.Host` is running
2. call `GET /api/settings/host-status`
3. confirm exactly one connected Revit bridge session
4. call `POST /api/scripting/execute` with an `InlineSnippet`
5. use the result payload before assuming the script failed silently

## What Turned Out To Matter

- Host HTTP is the public entrypoint.
- Host scripting forwards over the private Host/Revit WebSocket bridge.
- Scripting requires exactly one connected bridge session.
- The fastest first probe is an inline snippet, not workspace bootstrap.
- The Revit runtime executes one non-abstract `PeScriptContainer`.
- Revit-side execution is transaction-backed.
- Default script templates already include `Autodesk.Revit.DB.Electrical`.

## Obstacles Hit

- Needed to verify the host was actually running before any scripting assumptions were useful.
- Needed to verify bridge connection separately from host availability.
- Early confusion came from transport/session posture more than from compile/runtime code issues.
- `PanelScheduleView.GetPanel()` and `GetTemplate()` in R25 return `ElementId`, not the target element.
- One panel-schedule probe looked empty because Revit was left in template-edit view.

## Broader Context Gathered

- `Pe.Host` is the public product surface.
- `Pe.Revit.Scripting` is the Revit-side execution engine.
- `CmdScriptingWorkspace` is useful for local workspace bootstrapping, but not required for the shortest external probe path.
- `POST /api/scripting/execute` is the main live-document inspection tool for research work.

## Minimal Probe Shape

```json
{
  "workspaceKey": "default",
  "sourceKind": "InlineSnippet",
  "sourceText": "using Autodesk.Revit.DB; public class Probe : PeScriptContainer { public override void Execute() { WriteLine(Document?.Title ?? \"no doc\"); } }"
}
```

## When To Suspect Context Instead Of Code

- host-status is bad
- there is not exactly one bridge session
- the document/view state is unusual
- the output shape contradicts what Revit visibly shows
