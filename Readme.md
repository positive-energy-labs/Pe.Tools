# Pe.Tools

An addin suite that lets AI agents operate Revit safely, and lets the scripts they write grow into real addins.

Revit automation today splits into two bad options. Interpreted scripting (pyRevit, Dynamo) is quick to start but untyped, unguarded, and a rewrite away from a real addin. Compiled addins are robust but too slow to iterate for one-off work. Pe.Tools is one path that starts as a script and ends as an addin, with an AI agent driving at every step.

## If you use Revit

You describe what you want. The agent writes a script, runs it against your open model, and shows you the result before anything is saved.

- **Nothing changes without your approval.** Scripts run read-only by default. A script that tries to modify the model in read-only mode is caught and rolled back by the runtime, not by trust in the agent. Writes happen only when you grant write mode, inside one transaction that rolls back completely if anything fails.
- **It works on your open session.** No exporting, no launching a second Revit, no journal replay. The agent talks to the Revit you already have open, on the model you're looking at.
- **Failures are legible.** A script that fails tells you which stage failed (compile, permission, runtime) and why, instead of freezing Revit or dumping a stack trace.
- **Useful scripts become buttons.** A script you run more than once can surface in a palette inside Revit. You don't need to know it's a script.

Typical asks: "renumber these rooms by level and sequence", "find every duct that crosses a rated wall and list the missing dampers", "audit this model for unplaced rooms and orphaned tags". The agent proposes, you approve.

## If you build Revit tools

Scripts here are plain C#, compiled with Roslyn against the real Revit API, executed in the live session over a local host the agent reaches through MCP.

- **Full types, real project.** Each script workspace is an SDK-style csproj referencing RevitAPI, RevitAPIUI, and the Pe SDK. You get IntelliSense in your editor and the agent gets compile-time contracts instead of stale stubs. NuGet package references resolve from the local cache.
- **A typed failure surface.** Every execution returns a status (`Succeeded`, `CompilationFailed`, `RuntimeFailed`, `PolicyRejected`, `TimedOut`, ...) with stage-tagged diagnostics. On a compile error the runtime injects the authoring contract into the diagnostics, so an agent fixes its own mistake on the next attempt without a human decoding a traceback.
- **Guardrails in the runtime, not in prose.** Static policy rejects process spawning, P/Invoke, and script-owned transactions before execution. Read-only mode is enforced by a commit-then-rollback transaction group that detects real mutations via Revit's own change events. Timeouts and cancellation are built in.
- **Script to addin is a promotion, not a rewrite.** A script and an addin share the same SDK and types. When a script shape stabilizes, you move the code into an `[Op]`-attributed operation: it auto-registers, gets generated request/response schemas, and becomes discoverable to agents through the operation catalog. The rule of thumb: recurring questions about model state get typed ops; uncommon transforms stay scripts, where human approval is the type system.
- **Portable by source.** A script workspace (a "pod") exports as a source-first zip with machine-local references stripped. The SDK ships on NuGet, so a pod builds anywhere the SDK restores.

## Why not pyRevit?

pyRevit is the right tool for humans building ribbon buttons fast, and its community is unmatched. It is the wrong substrate for agents: its HTTP API is an unauthenticated draft, its stable engine is Python 2.7 semantics, its typing story is dormant third-party stubs, its CLI runner launches a fresh Revit per run, and graduating a script to a compiled addin is a rewrite. Pe.Tools trades pyRevit's reach for typed contracts, an enforced safety model, session-targeted execution, and a promotion path that keeps your code.
