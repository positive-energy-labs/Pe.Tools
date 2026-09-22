# Pe.Tools

An addin suite where you and Pea, a coding agent built for Revit, inspect models, review changes, and turn useful work into reusable tools and standards.

Start with the model you have and describe what you want. Pea can use an existing operation, help you author a family or schedule definition, or write C# for work that needs something new. You inspect the work, decide what changes, and keep whatever is worth using again. A one-off script can become a button; a useful definition can become a shared standard.

## If you use Revit

You describe what you want. Pea helps you inspect the document and prepare the change. Chat and the detailed tools are meant to show the same work: ask for a change in the conversation, review its proposals, and open the full table or editor when you need more detail.

- **Start with the real document.** Inspect a family, review a project's families, or edit a schedule without first designing a reusable tool. A conversation carries its document context across the tools; execution checks the particular open document it is about to touch.
- **Review the work that will run.** The product direction is draft first: inspect, edit with Pea, review, then apply. Saving that draft for reuse is a separate choice. A plan must describe the input being applied, not older saved text hidden behind the editor.
- **Writes have an explicit boundary.** Scripts run read-only by default, enforced by the runtime. Mutation permissions and human-only actions belong in execution contracts. Cancellation and failure must report what actually happened; stopping a bulk operation does not imply that its completed work was undone.
- **Runs should explain themselves.** The standard is an inspectable input, target, outcome, and output set. A lost response is an unknown outcome to recover, not permission to run the same change again. Script diagnostics distinguish compilation, policy, and runtime failures.
- **Useful scripts become buttons.** A script you run more than once can surface in a palette inside Revit. You don't need to know it's a script.

Typical asks: "audit this family and propose the missing parameters", "rename this parameter across the project's families", "turn this schedule definition into a standard we can reuse", or "find every duct that crosses a rated wall and list the missing dampers". Existing tools handle recurring work; scripts handle the unusual parts.

## Keep the useful parts in a Pod

A Pod is a folder of source: scripts, typed JSON definitions, reusable fragments, and assets. It can be an addin idea, an office standard, or a small collection of things that save you time. A Pod containing only definitions needs no script.

- **Open the same material wherever you need it.** Browse a member in Pods or open it inside its Family or Schedule workflow. Form and raw JSON views edit the same material; its schema says what it means.
- **Compose a standard instead of copying it everywhere.** Reuse shared fragments locally. Export carries the foreign fragments the Pod consumes and rewrites their references, so the recipient does not need your sibling Pods. The result remains editable source.
- **Share it, then ask Pea to adapt it.** Scripts, definitions, and their ingredients travel together. Folder names are addresses, not identity; a folder rename should not invalidate the work inside it.

Pe.Tools is under active development. Draft-first authoring, shared Chat proposals, input capture in run outputs, and recovery controls are still being made consistent across the product. They are the direction, not a claim that every route has finished the transition.

## If you build Revit tools

Scripts here are plain C#, compiled with Roslyn against the real Revit API, executed in the live session over a local host the agent reaches through MCP.

- **Full types, real project.** Each script workspace is an SDK-style csproj referencing RevitAPI, RevitAPIUI, and the Pe SDK. You get IntelliSense in your editor and the agent gets compile-time contracts instead of stale stubs. NuGet package references resolve from the local cache.
- **A typed failure surface.** Every execution returns a status (`Succeeded`, `CompilationFailed`, `RuntimeFailed`, `PolicyRejected`, `TimedOut`, ...) with stage-tagged diagnostics. On a compile error the runtime injects the authoring contract into the diagnostics, so an agent fixes its own mistake on the next attempt without a human decoding a traceback.
- **Guardrails in the runtime, not in prose.** Static policy rejects process spawning, P/Invoke, and script-owned transactions before execution. Read-only mode is enforced by a commit-then-rollback transaction group that detects real mutations via Revit's own change events. Timeouts and cancellation are built in.
- **One meaning across callers.** Domain libraries own what an operation means. Pea, the web UI, palettes, and scripts use those libraries and contracts. A new surface should not invent another version of the rules.
- **Script to addin is a promotion, not a rewrite.** A script and an addin share the same SDK and types. Stable capabilities can become registered operations with request/response schemas and agent-facing discovery. Recurring model questions get typed operations; uncommon transforms stay scripts.
- **Portable by source.** Pods export as source archives. Script workspaces keep real project files and SDK references; reusable JSON keeps its schemas and composition. The recipient gets material they can inspect and change.

The architectural rule is one authority for each fact and lifetime. Authored intent, observed Revit state, navigation, and execution outcomes are different facts. Share their owners across surfaces, preserve those distinctions, and make the boundaries small enough that both a person and an agent can understand them.

## Why this approach?

Pe.Tools is built around a different bet: an agent and a human should share typed, inspectable work all the way from a one-off request to a reusable tool. C# scripting is one part of that path, alongside document operations, collaborative drafts, and portable standards. The aim is to keep the useful code and source as the work grows, with permissions, targeting, and outcomes enforced by the runtime.
