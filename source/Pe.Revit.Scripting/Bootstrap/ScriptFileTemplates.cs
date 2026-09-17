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

    public static string CreateRootReadme() =>
        $$"""
        # Pe.Tools

        This folder is the Pe.Tools content home: your preferences and your pods.

        - `{{ProductPathNames.PreferencesFileName}}` - product-wide user preferences.
        - `{{ProductPathNames.PodsDirectoryName}}/<folder>/` - one pod: `{{ProductPathNames.PodManifestFileName}}` plus any of `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/`, `{{ProductPathNames.SettingsDirectoryName}}/`, `{{ProductPathNames.AssetsDirectoryName}}/`, `{{ProductPathNames.OutputDirectoryName}}/`.

        Runtime state, logs, caches, credentials, and installed binaries live under Local AppData, not this folder.

        `{{ProductPathNames.AgentInstructionsFileName}}` beside this file is the guide. Bootstrap rewrites it every time, so keep your own notes here instead.
        """;

    public static string CreateRootAgents() =>
        $$"""
        # Pe.Tools

        ## Scope

        Agent guidance for the Pe.Tools content home: product preferences and every installed pod. Runtime state, logs, caches, credentials, and installed binaries live under Local AppData, not here.

        ## What a pod is

        A pod is one folder under `{{ProductPathNames.PodsDirectoryName}}/<folder>/` holding `{{ProductPathNames.PodManifestFileName}}`, and any of:

        - `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/` - C# scripts.
        - `{{ProductPathNames.SettingsDirectoryName}}/` - JSON members and fragments.
        - `{{ProductPathNames.AssetsDirectoryName}}/` - files a member or a script reads.
        - `{{ProductPathNames.OutputDirectoryName}}/` - one folder per run; never published.

        Nothing else is a pod. Every file in a pod is a **member**, addressed everywhere as `{ pod: <id>, path: <relative path> }`.

        ## Identity

        Three facts, and no others:

        - the folder name is an address, never identity. Rename it freely.
        - the manifest `id` is the lineage. `@<id>/<path>` resolves to the installed pod with that id; two installed pods sharing an id fail and name both folders.
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

        Every apply and every entrypoint run writes `{{ProductPathNames.OutputDirectoryName}}/<runId>/` inside the pod it acted from: `receipt.json` - pod id, member path, member sha256, op id, plan hash, outcome, output references - with the run's own files beside it. Capture writes its evidence there too, so the captured member holds only what an engine can apply.

        Output is never published. Export and archive leave it behind.

        `{{ProductPathNames.PodsDirectoryName}}/{{ScriptingWorkspaceLayout.DefaultWorkspaceKey}}/{{ProductPathNames.OutputDirectoryName}}/` is the one exception: it keeps inline snippet traces under `inline/`, and the runs of scripts that came from no pod.

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
        - every `<Reference>` and `<PackageReference>` in the pod's `{{ScriptingWorkspaceLayout.ProjectFileName}}`. Bootstrap seeds it with the scripting runtime, its `Pe.Revit*` siblings, `Pe.Shared.HostContracts`, `Pe.Shared.Product`, `Pe.Shared.RevitData`, `Newtonsoft.Json`, `RevitAPI`, and `RevitAPIUI`.
        - NuGet packages already present in the local package cache. A package that is not installed is a resolve error, not a download.

        Any other assembly Revit has loaded is reachable, but not automatically: add a `<Reference>` naming it, with a `<HintPath>` to its dll, in `{{ScriptingWorkspaceLayout.ProjectFileName}}`. At run time the resolver prefers the copy Revit already has loaded over the file on disk unless the disk build differs, so what the script compiles against and what it runs against are the same build.

        ## Bootstrap

        Bootstrap runs when Pe.Tools creates or refreshes a pod. It is the only writer of the files below.

        In this folder:

        - `{{ProductPathNames.AgentInstructionsFileName}}` (this file) is **rewritten** whenever it differs from the shipped text. Edits here do not survive.
        - `{{ProductPathNames.ReadmeFileName}}` is created only when missing.

        In the pod:

        - `{{ProductPathNames.AgentInstructionsFileName}}`, `{{ProductPathNames.ReadmeFileName}}`, and `.vscode/settings.json` are created only when missing.
        - `{{ProductPathNames.PodManifestFileName}}` and `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/{{ScriptingWorkspaceLayout.SampleScriptFileName}}` are created only when missing, and only for a pod bootstrapped with the sample.
        - the `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/`, `{{ProductPathNames.SettingsDirectoryName}}/`, `{{ProductPathNames.AssetsDirectoryName}}/`, `{{ProductPathNames.OutputDirectoryName}}/`, and `.vscode/` folders are created when missing.
        - `{{ScriptingWorkspaceLayout.ProjectFileName}}` is **rewritten** every time, preserving what you wrote: a `<Reference>` without `<Private>false</Private>` is yours and survives, machine entries are re-derived, and your `HintPath` wins a name collision.

        `.vscode/` and `{{ScriptingWorkspaceLayout.ProjectFileName}}` exist for editing and IntelliSense on a pod with scripts. Delete either one - nothing refuses a pod without them, and the next bootstrap puts them back.
        """;

    public static string CreatePodReadme() =>
        $$"""
        # Pe Revit Scripting

        This pod was generated by Pe.Tools for Revit script authoring.

        Supported execution:

        - pod entrypoint scripts under `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/`, declared in `{{ProductPathNames.PodManifestFileName}}`
        - inline snippets, saved visibly under `{{ProductPathNames.PodsDirectoryName}}/{{ScriptingWorkspaceLayout.DefaultWorkspaceKey}}/{{ProductPathNames.OutputDirectoryName}}/inline/`
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
        - Add local DLL refs and `PackageReference` items in `{{ScriptingWorkspaceLayout.ProjectFileName}}`.
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

        Agent guidance local to this one pod. What a pod is, identity, `$schema`, composition, entrypoints as buttons, where output and receipts land, and which files bootstrap owns are all in `../../{{ProductPathNames.AgentInstructionsFileName}}`. Read that first.

        ## Entry points

        - `{{ProductPathNames.PodManifestFileName}}` - this pod's `id`, `name`, `version`, and `entrypoints`.
        - `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/` - scripts. Declare a runnable one in `{{ProductPathNames.PodManifestFileName}}` before expecting a button.
        - `{{ProductPathNames.SettingsDirectoryName}}/` - JSON members; each one's `$schema` says what it is for.
        - `{{ProductPathNames.AssetsDirectoryName}}/` - files members and scripts read.
        - `{{ProductPathNames.OutputDirectoryName}}/<runId>/` - one run, its `receipt.json`, and its files.
        - `{{ScriptingWorkspaceLayout.ProjectFileName}}` - your DLL and package references; editing support only.

        ## Authoring a script here

        - Exactly one non-abstract `PeScriptContainer` per entrypoint file. Other `{{ScriptingWorkspaceLayout.SourceDirectoryName}}/**/*.cs` files compile alongside and are not runnable.
        - Inside `Execute()`: `doc`, `uidoc`, `app`, `selection`, `revitVersion`, `ct`, `Artifacts`, `Result(...)`, `WriteLine(...)`, `Notify(...)`.
        - `Result(...)` once per run for structured JSON, `WriteLine(...)` for short diagnostics, `Artifacts` for durable files.
        - `ReadOnly` (the default) runs inside a rollback guard: document changes are discarded and reported as a warning. `WriteTransaction` opens one host-owned transaction. `NoTransaction` leaves transaction boundaries to the script or the library it calls.
        - Check `ct` (or call `ThrowIfCancelled()`) inside loops; a script that never checks cannot be interrupted by the timeout or by cancel.
        - Scripts are trusted in-process C# inside Revit, not an OS sandbox. `ReadOnly` is a document guarantee, not machine isolation.
        - Add references in `{{ScriptingWorkspaceLayout.ProjectFileName}}`, and re-run bootstrap after a Revit version change or a missing generated reference.
        - Use host and agent tools outside the script to discover operation shapes; keep the script itself on direct, bounded Revit API work.

        ## Notes

        - Inline snippets are traceable probes, not the durable authoring surface here.
        - Runtime behaviour depends on the Revit-side assemblies actually loaded in the session.
        """;

    public static string CreateVscodeSettings() =>
        """
        {
          "dotnet.defaultSolution": "PeScripts.csproj",
          "files.exclude": {
            "**/bin": true,
            "**/obj": true
          }
        }
        """;

    public static string CreateSampleScript() =>
        """
        // This file is declared as an entrypoint in pod.json, so it is a button on the
        // Scripts tab of Revit's Do palette (run safe / run full). Its pod.json name and
        // description are that button's label and subtitle.
        //
        // Outside the palette, run it from this pod's root:
        // pea script execute --source-path src/SampleScript.cs
        // Keep exactly one non-abstract PeScriptContainer per entrypoint file.

        public sealed class SampleScript : PeScriptContainer
        {
            public override void Execute()
            {
                WriteLine($"Running in Revit {revitVersion}.");

                if (doc == null)
                {
                    WriteLine("No active document.");
                    return;
                }

                // Check ct in loops so timeouts and scripting.cancel can interrupt long work.
                ThrowIfCancelled();

                // Result(...) returns structured JSON to the caller; Artifacts writes durable files.
                var report = new
                {
                    document = doc.Title,
                    revitVersion,
                    selectedElementCount = selection.Count
                };
                Artifacts.WriteJson("result.json", report);
                Result(report);
            }
        }
        """;

    public static string CreatePodManifest(string workspaceKey) =>
        $$"""
        {
          "schemaVersion": 2,
          "id": "{{(ScriptingWorkspaceLayout.IsWorkspaceSlug(workspaceKey) ? workspaceKey : "pod-" + Guid.NewGuid().ToString("N"))}}",
          "name": "{{workspaceKey}}",
          "version": "0.1.0",
          "entrypoints": [
            {
              "id": "sample",
              "sourcePath": "src/SampleScript.cs",
              "name": "Sample Script",
              "description": "Minimal example: reports the active document as a structured result."
            }
          ]
        }
        """;
}
