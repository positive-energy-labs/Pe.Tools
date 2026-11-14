using Pe.Revit.Scripting.Storage;
using Pe.Shared.Product;

namespace Pe.Revit.Scripting.Bootstrap;

internal static class ScriptFileTemplates {
    public static readonly IReadOnlyList<string> DefaultUsings = [
        "System",
        "System.Collections.Generic",
        "System.Diagnostics",
        "System.IO",
        "System.Linq",
        "System.Text",
        "System.Text.RegularExpressions",
        "Autodesk.Revit.DB",
        "Autodesk.Revit.DB.Architecture",
        "Autodesk.Revit.DB.Electrical",
        "Autodesk.Revit.DB.Mechanical",
        "Autodesk.Revit.DB.Plumbing",
        "Autodesk.Revit.DB.Structure",
        "Autodesk.Revit.UI",
        "Pe.Revit.Scripting",
        "Pe.Revit.Scripting.Context",
        "Pe.Shared.RevitData",
        "Pe.Shared.RevitData.Schedules"
    ];

    /// <summary>
    ///     The authored project a pod keeps (homes freeze shape 8). It carries one import, spelled the same on
    ///     every machine, and whatever references a person adds. Bootstrap never rewrites it.
    /// </summary>
    public static string CreateProject() =>
        $$"""
        <Project Sdk="Microsoft.NET.Sdk">
          <Import Project="{{ProductPathing.MachinePropsImport}}" />

          <ItemGroup>
            <!-- Your own <Reference> and <PackageReference> items go here. -->
          </ItemGroup>
        </Project>

        """;

    /// <summary>The agent guide. It lives in the agent's working directory, never in a home, and is rewritten.</summary>
    public static string CreateAgentGuide() =>
        $$"""
        # Pe.Tools

        ## Scope

        Agent guidance for Pe.Tools pods. A pod lives in one of three content homes: yours, the project's, or the firm's. A home holds authored files only. Run output, logs, caches, credentials, and installed binaries are machine state and never sit in a home.

        ## What a pod is

        A pod is one folder under `{{ProductPathNames.PodsDirectoryName}}/<folder>/` holding `{{ProductPathNames.PodManifestFileName}}`, and any of:

        - C# scripts, `.cs` or `.csx`, at any path. `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/` is the usual home; a script may also sit beside the Page that runs it. One that `{{ProductPathNames.PodManifestFileName}}` declares as an entrypoint runs by the key `script:@<id>/<path>`.
        - `pages/<page>/index.html` - a Page: plain HTML that loads `/pages/pe.js`, written as a file.
        - `skills/<name>/SKILL.md` - the guidance an agent gets about this pod.
        - `{{ProductPathNames.SettingsDirectoryName}}/` - JSON members and fragments.
        - `{{ProductPathNames.AssetsDirectoryName}}/` - files a member or a script reads.

        Every file in a pod is a **member**, addressed everywhere as `{ pod: <id>, path: <relative path> }`. Nothing made at run time is one: run output, a Page's event log and its binding are machine state, as the section on output says. The `build-pod` skill under `.agents/skills/` is the full account of entrypoints, script input and Pages.

        ## Identity

        Three facts, and no others:

        - the folder name is an address, never identity. Rename it freely.
        - the manifest `id` is the lineage, unique across every home. `@<id>/<path>` resolves to the installed pod with that id; two installed pods sharing an id fail and name both folders.
        - each member's SHA-256 is derived from its bytes and is never stored.

        `version` is a human label. Nothing resolves against it.

        ## What a member is for

        `$schema` is the only thing that says what a JSON member is for. A filename suffix selects nothing. A member with no `$schema` is plain data, and no library validates it. A member whose `$schema` an engine applies is a **spec**.

        ## Composition

        `$include` and `$preset` compose one member at a time, at the moment it is used:

        - `@local/<path>` resolves inside the same pod.
        - `@<id>/<path>` resolves to the installed pod whose manifest `id` matches.

        There are no hash pins. Export vendors every foreign fragment into `{{ProductPathNames.SettingsDirectoryName}}/_vendor/<id>/<path>` and rewrites the reference to `@local/_vendor/...`, so an archive composes from its own bytes. Import writes one `imported.json` (archive sha256, locator, date) as provenance; nothing validates it and nothing gates on it.

        Preparation gates `{{ProductPathNames.PodManifestFileName}}` structure and entrypoint source only. Members validate one at a time, when used, so a bad member never hides its siblings.

        ## Entrypoints are buttons

        Every entrypoint declared in `{{ProductPathNames.PodManifestFileName}}` is a button on the Scripts tab of Revit's Do palette, with two actions: run safe (document changes discarded) and run full (kept). The palette rebuilds its list each time it is summoned, so a new entrypoint appears without restarting Revit, and it runs in-process on the Revit lane even when Pea is closed and the host is disconnected.

        The entrypoint `name` and `description` are the button's label and subtitle; the pod `name` is the filter pill. Write all three for the practitioner who presses the button. An entrypoint with no `name` shows its raw id, and a pod whose `{{ProductPathNames.PodManifestFileName}}` fails validation shows no buttons at all.

        ## Output and receipts

        Every apply and every entrypoint run writes one run folder in machine state, `state/Runs/<pod id>/<runId>/`, keyed on the id of the pod it acted from: `receipt.json` - pod id, member path, member sha256, op id, plan hash, outcome, output references - with the run's own files beside it. Capture writes its evidence there too, so the captured member holds only what an engine can apply.

        A run writes nothing into the pod. A pod can sit in a home that other people share, and output is never published.

        `state/Runs/{{ProductPathNames.PodlessRunsDirectoryName}}/` holds the runs of scripts that came from no pod, one folder per run. `state/Runs/{{ProductPathNames.ModuleOutputDirectoryName}}/` holds the files the pod-less Do palette tasks write for you to open. `state/Runs/{{RevitScriptingStorageLocations.InlineTraceDirectoryName}}/` holds the source of each inline snippet that ran.

        ## Where to work

        | To do this | Go here |
        | --- | --- |
        | browse pods, edit a member, read its runs | the `/pods` route |
        | capture, edit, and apply one family | the `/family` route |
        | the same across loaded families | the `/families` route |
        | capture and apply a schedule, push cell values | the `/schedules` route |
        | run an entrypoint from a terminal or a non-Pea agent | `pea script execute --source-path src/YourScript.cs` |
        | run an entrypoint inside Revit | the Do palette, Scripts tab |
        | follow a workflow Pea already knows | `.agents/skills/` beside this file |

        `/pods` performs no Revit action. It browses, edits, runs entrypoints, and links to the product route that does.

        ## What a script may reference

        A script compiles and runs against exactly three sources:

        - the framework assemblies already loaded in the Revit process - `System*`, `Microsoft*`, `mscorlib`, `netstandard`, `WindowsBase`, `PresentationCore`, `PresentationFramework`. These are automatic.
        - every `<Reference>` and `<PackageReference>` you add in the pod's `{{ScriptingWorkspaceLayout.ProjectFileName}}`, plus the references this machine supplies: the scripting runtime, its `Pe.Revit*` siblings, `Pe.Shared.HostContracts`, `Pe.Shared.Product`, `Pe.Shared.RevitData`, `Newtonsoft.Json`, `RevitAPI`, and `RevitAPIUI`.
        - NuGet packages already present in the local package cache. A package that is not installed is a resolve error, not a download.

        Any other assembly Revit has loaded is reachable, but not automatically: add a `<Reference>` naming it, with a `<HintPath>` to its dll, in `{{ScriptingWorkspaceLayout.ProjectFileName}}`. To point at your own build of an assembly this machine already supplies, write `<Reference Update="Name">` with your `<HintPath>`; yours wins. At run time the resolver prefers the copy Revit already has loaded over the file on disk unless the disk build differs, so what the script compiles against and what it runs against are the same build.

        ## Bootstrap

        Bootstrap runs when Pe.Tools creates or refreshes a pod.

        In the pod it only seeds. Each of these is created when missing and never rewritten, so a pod reads the same on every machine:

        - `{{ProductPathNames.PodManifestFileName}}`, `{{ProductPathNames.AgentInstructionsFileName}}`, `{{ProductPathNames.ReadmeFileName}}`, and `{{ScriptingWorkspaceLayout.ProjectFileName}}`.
        - the `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/`, `{{ProductPathNames.SettingsDirectoryName}}/`, and `{{ProductPathNames.AssetsDirectoryName}}/` folders.

        Outside every home it rewrites two machine files:

        - `{{ProductPathing.MachinePropsImport}}` - this machine's Revit and Pe assembly paths and build settings. Every pod's `{{ScriptingWorkspaceLayout.ProjectFileName}}` imports it, so `dotnet build` in a pod validates its scripts offline, with no host and no Revit.
        - this file. Edits here do not survive.

        `{{ScriptingWorkspaceLayout.ProjectFileName}}` is yours: it holds the one import and the references you add. Delete it and nothing refuses the pod; the next bootstrap seeds it again.
        """;

    public static string CreatePodReadme() =>
        $$"""
        # Pe Revit Scripting

        This pod was generated by Pe.Tools for Revit script authoring.

        Supported execution:

        - pod entrypoint scripts under `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/`, declared in `{{ProductPathNames.PodManifestFileName}}`
        - inline snippets, traced in machine state, never in a pod
        - synchronous execution through the Pe.Tools Revit bridge

        Authoring contract:

        - Put durable scripts under `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/` as normal C# files and declare each runnable one in `{{ProductPathNames.PodManifestFileName}}` under `entrypoints`.
        - Every declared entrypoint is a button on the Scripts tab of Revit's Do palette, with a safe action (changes discarded) and a full action (changes kept). Its `name` and `description` are the button label and subtitle, so write them for whoever presses the button. A pod whose `{{ProductPathNames.PodManifestFileName}}` fails validation shows no buttons at all.
        - Outside the palette, run an entrypoint with `pea script execute --source-path src/MyScript.cs`.
        - Each entrypoint source file must contain exactly one non-abstract `PeScriptContainer`; helper `src/**/*.cs` files compile alongside but are not runnable.
        - Inline snippets may be Execute-body statements with optional leading `using` directives, or a full `PeScriptContainer` class.
        - Inside `Execute()`, use `doc`, `uidoc`, `app`, `selection`, `revitVersion`, `ct`, `Artifacts`, `Result(...)`, `WriteLine(...)`, and `Notify(...)` (progress messages pushed to the caller mid-run).
        - `ReadOnly` (the default) runs inside a rollback guard: document changes are discarded and reported as a warning. Use `WriteTransaction` for one host-owned transaction, or `NoTransaction` when the script or called library must own transaction boundaries.
        - Scripts are trusted in-process C# inside Revit, not an OS/process security sandbox. `ReadOnly` controls document transaction behavior only.
        - Long-running scripts should check `ct` (or call `ThrowIfCancelled()`) inside loops so cancellation and the execution timeout can interrupt them.
        - Use `Result(...)` once per run to return structured JSON to the caller; `WriteLine(...)` for short human-readable output; `Artifacts.WriteJson/WriteCsv/WriteText(...)` for durable files.
        - Add local DLL refs and `PackageReference` items in `{{ScriptingWorkspaceLayout.ProjectFileName}}`. It imports this machine's Revit and Pe references, so `dotnet build` here checks your scripts offline.
        - Use host/agent tools outside the script to discover operation shapes; scripts should do direct bounded Revit API work.

        Non-goals for this pod:

        - arbitrary local file execution outside the pod
        - compiled DLL/package payload execution
        - async scripting sessions
        """;

    public static string CreatePodAgents() =>
        $$"""
        # Pod

        ## Scope

        Agent guidance local to this one pod. What a pod is, identity, `$schema`, composition, entrypoints as buttons, where output and receipts land, and which files bootstrap owns are all in the Pe.Tools agent guide, the `{{ProductPathNames.AgentInstructionsFileName}}` in the agent's working directory. Read that first.

        ## Entry points

        - `{{ProductPathNames.PodManifestFileName}}` - this pod's `id`, `name`, `version`, and `entrypoints`.
        - `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/` - scripts. Declare a runnable one in `{{ProductPathNames.PodManifestFileName}}` before expecting a button.
        - `{{ProductPathNames.SettingsDirectoryName}}/` - JSON members; each one's `$schema` says what it is for.
        - `{{ProductPathNames.AssetsDirectoryName}}/` - files members and scripts read.
        - `{{ScriptingWorkspaceLayout.ProjectFileName}}` - your DLL and package references; editing support only.

        ## Authoring a script here

        - Exactly one non-abstract `PeScriptContainer` per entrypoint file. Other `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/**/*.cs` files compile alongside and are not runnable.
        - Inside `Execute()`: `doc`, `uidoc`, `app`, `selection`, `revitVersion`, `ct`, `Artifacts`, `Result(...)`, `WriteLine(...)`, `Notify(...)`.
        - `Result(...)` once per run for structured JSON, `WriteLine(...)` for short diagnostics, `Artifacts` for durable files.
        - `ReadOnly` (the default) runs inside a rollback guard: document changes are discarded and reported as a warning. `WriteTransaction` opens one host-owned transaction. `NoTransaction` leaves transaction boundaries to the script or the library it calls.
        - Check `ct` (or call `ThrowIfCancelled()`) inside loops; a script that never checks cannot be interrupted by the timeout or by cancel.
        - Scripts are trusted in-process C# inside Revit, not an OS sandbox. `ReadOnly` is a document guarantee, not machine isolation.
        - Add references in `{{ScriptingWorkspaceLayout.ProjectFileName}}`, and re-run bootstrap after a Revit version change or a missing machine reference.
        - Use host and agent tools outside the script to discover operation shapes; keep the script itself on direct, bounded Revit API work.

        ## Notes

        - Inline snippets are traceable probes, not the durable authoring surface here.
        - Runtime behaviour depends on the Revit-side assemblies actually loaded in the session.
        """;

    public static string CreatePodManifest(string workspaceKey) =>
        $$"""
        {
          "schemaVersion": 2,
          "id": "{{(ScriptingWorkspaceLayout.IsWorkspaceSlug(workspaceKey) ? workspaceKey : "pod-" + Guid.NewGuid().ToString("N"))}}",
          "name": "{{workspaceKey}}",
          "version": "0.1.0",
          "entrypoints": []
        }
        """;
}
