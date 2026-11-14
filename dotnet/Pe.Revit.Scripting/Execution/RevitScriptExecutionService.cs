using Pe.Revit.Compat;
using Pe.Revit.Operations;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Revit.Failures;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.References;
using Pe.Revit.Scripting.Storage;
using Pe.Revit.Tasks;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Analysis;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Pods;
using Pe.Shared.Scripting.Policy;
using Serilog;
using System.Reflection;
using System.Text;

namespace Pe.Revit.Scripting.Execution;

public sealed class RevitScriptExecutionService(
    ScriptProjectGenerator projectGenerator,
    ScriptReferenceResolver referenceResolver,
    ScriptAssemblyLoadService assemblyLoadService,
    ScriptCompilationService compilationService,
    Func<UIApplication?> uiApplicationAccessor,
    Action<string>? notificationSink = null,
    // The host's word on where a pod's folder is. A test names its own home here, never the person's host.
    ScriptPodPreparationService? pods = null
) {
    private const int MaxInlineSourceBytes = 256 * 1024;

    private readonly ScriptAssemblyLoadService _assemblyLoadService = assemblyLoadService;
    private readonly ScriptCompilationService _compilationService = compilationService;
    private readonly ScriptEntryPointResolver _entryPointResolver = new(nameof(PeScriptContainer));
    private readonly ScriptPolicyAnalyzer _policyAnalyzer = ScriptPolicyAnalyzer.CreateDefault();
    private readonly Action<string>? _notificationSink = notificationSink;
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;
    private readonly ScriptReferenceResolver _referenceResolver = referenceResolver;
    private readonly Func<UIApplication?> _uiApplicationAccessor = uiApplicationAccessor;

    private const string AuthoringShapeHint = "Inline scriptContent accepts Execute-body statements such as WriteLine(\"...\"), with optional leading using directives, or a full container class: public sealed class Script : PeScriptContainer { public override void Execute() { WriteLine(\"...\"); } }. Execute() returns void. Pod scripts are normal C# files with one PeScriptContainer; pod.json entrypoints expose palette buttons. Inside Execute(), use doc, uidoc, app, selection, revitVersion, ct, Artifacts, Result(...), and WriteLine(...).";

    /// <summary>Standard wiring shared by the bridge transport and the in-process palette runner.</summary>
    public static RevitScriptExecutionService CreateDefault(
        Func<UIApplication?> uiApplicationAccessor,
        Action<string>? notificationSink = null
    ) {
        var csProjReader = new CsProjReader();
        return new RevitScriptExecutionService(
            new ScriptProjectGenerator(csProjReader),
            new ScriptReferenceResolver(csProjReader),
            new ScriptAssemblyLoadService(),
            new ScriptCompilationService(ScriptFileTemplates.DefaultUsings),
            uiApplicationAccessor,
            notificationSink
        );
    }

    public ExecuteRevitScriptData Execute(
        Document? document,
        ExecuteRevitScriptRequest request,
        string executionId,
        ScriptCancellationScope? cancellation = null
    ) {
        cancellation ??= ScriptCancellationScope.None;
        // ScriptSaveHold uses this caller throughout execution to hold only guarded project saves.
        using var run = ScriptRunScope.Enter(request.Caller);
        Log.Information(
            "Revit scripting execute starting: ExecutionId={ExecutionId}, WorkspaceKey={WorkspaceKey}, SourcePath={SourcePath}",
            executionId,
            request.WorkspaceKey,
            request.SourcePath
        );

        var diagnostics = new List<ScriptDiagnostic>();
        var outputSink = new ScriptOutputSink();
        var revitVersion = "unknown";
        var targetFramework = string.Empty;
        string? containerTypeName = null;
        RevitScriptContext? executionContext = null;

        try {
            var planResult = this.NormalizeRequest(document, request, executionId);
            Log.Information(
                "Revit scripting normalize completed: ExecutionId={ExecutionId}, Status={Status}, Diagnostics={DiagnosticCount}",
                executionId,
                planResult.Status,
                planResult.Diagnostics.Count
            );
            foreach (var diagnostic in planResult.Diagnostics)
                AppendDiagnostic(diagnostics, diagnostic);

            if (planResult.Plan == null) {
                return CreateResult(
                    planResult.Status,
                    outputSink,
                    diagnostics,
                    revitVersion,
                    targetFramework,
                    containerTypeName,
                    executionId
                );
            }

            var plan = planResult.Plan;
            // A pod run is keyed on its manifest id; an inline snippet acts from no pod, so its run lands
            // in the pod-less runs beside the inline traces, as operation input that names no member.
            outputSink.Artifacts = new ScriptArtifactWriter(plan.PodManifest?.Id);
            revitVersion = plan.RevitVersion;
            try {
                outputSink.Attribution = plan.Attribution ?? PodReceipt.ForOperation(
                    null, "scripting.execute", null, PodRunOutcome.Failed, [], null);
                outputSink.Artifacts.WriteInput(PodRuns.WithReviewBasis(RunInputMetadata(plan, request), null), RunInputFiles(plan, request));
            } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException) {
                AppendDiagnostic(diagnostics, ScriptDiagnosticFactory.Error("run.input", $"The run input could not be saved, so nothing ran: {exception.Message}"));
                return CreateResult(ScriptExecutionStatus.Rejected, outputSink, diagnostics, revitVersion, plan.TargetFramework, containerTypeName, executionId);
            }
            targetFramework = plan.TargetFramework;
            Log.Information(
                "Revit scripting plan ready: ExecutionId={ExecutionId}, RevitVersion={RevitVersion}, TargetFramework={TargetFramework}, SourceFiles={SourceFileCount}, PermissionMode={PermissionMode}",
                executionId,
                revitVersion,
                targetFramework,
                plan.SourceSet.Files.Count,
                plan.PermissionMode
            );

            AppendDiagnostic(diagnostics, ScriptDiagnosticFactory.Info(
                "normalize",
                $"{DescribeExecutionMode(plan.ExecutionMode)} Executing {plan.SourceSet.EntryPointSourceName}; captured {plan.SourceSet.Files.Count} source file(s): {string.Join(", ", plan.SourceSet.Files.Select(file => file.Name))}.",
                plan.SourceSet.EntryPointSourceName
            ));

            var permissionDiagnostics = ValidatePermissionMode(plan);
            foreach (var diagnostic in permissionDiagnostics)
                AppendDiagnostic(diagnostics, diagnostic);
            if (permissionDiagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error)) {
                return CreateResult(
                    ScriptExecutionStatus.Rejected,
                    outputSink,
                    diagnostics,
                    revitVersion,
                    targetFramework,
                    containerTypeName,
                    executionId
                );
            }

            var resolvedProject = this.ResolveProject(plan);
            Log.Information(
                "Revit scripting resolve completed: ExecutionId={ExecutionId}, CompileRefs={CompileReferenceCount}, RuntimeRefs={RuntimeReferenceCount}, Diagnostics={DiagnosticCount}",
                executionId,
                resolvedProject.CompileReferencePaths.Count,
                resolvedProject.RuntimeReferencePaths.Count,
                resolvedProject.Diagnostics.Count
            );
            foreach (var diagnostic in resolvedProject.Diagnostics)
                AppendDiagnostic(diagnostics, diagnostic);

            if (resolvedProject.HasErrors) {
                return CreateResult(
                    ScriptExecutionStatus.ReferenceResolutionFailed,
                    outputSink,
                    diagnostics,
                    revitVersion,
                    targetFramework,
                    containerTypeName,
                    executionId
                );
            }

            var runtimeReferenceScope = this.LoadRuntimeReferences(plan, resolvedProject, diagnostics);
            Log.Information(
                "Revit scripting runtime references loaded: ExecutionId={ExecutionId}, MetadataReferences={MetadataReferenceCount}",
                executionId,
                runtimeReferenceScope.MetadataReferences.Count
            );
            if (diagnostics.Any(diagnostic =>
                    diagnostic.Stage == "resolve" && diagnostic.Severity == ScriptDiagnosticSeverity.Error)) {
                runtimeReferenceScope.ResolverScope.Dispose();
                return CreateResult(
                    ScriptExecutionStatus.ReferenceResolutionFailed,
                    outputSink,
                    diagnostics,
                    revitVersion,
                    targetFramework,
                    containerTypeName,
                    executionId
                );
            }

            using (runtimeReferenceScope.ResolverScope) {
                cancellation.Token.ThrowIfCancellationRequested();
                var policyUsings = ScriptFileTemplates.DefaultUsings.Concat(resolvedProject.Usings).ToList();
                plan = plan with {
                    SourceSet = ScriptSourceClosure.Select(plan.SourceSet, runtimeReferenceScope.MetadataReferences, policyUsings)
                };
                AppendDiagnostic(diagnostics, ScriptDiagnosticFactory.Info("policy",
                    $"Compiling {plan.SourceSet.Files.Count} entrypoint dependency source file(s): {string.Join(", ", plan.SourceSet.Files.Select(file => file.Name))}.",
                    plan.SourceSet.EntryPointSourceName));
                var policyDiagnostics = this._policyAnalyzer.Analyze(plan.SourceSet, plan.PermissionMode,
                    runtimeReferenceScope.MetadataReferences, policyUsings);
                foreach (var diagnostic in policyDiagnostics)
                    AppendDiagnostic(diagnostics, diagnostic);
                if (policyDiagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error))
                    return CreateResult(ScriptExecutionStatus.PolicyRejected, outputSink, diagnostics,
                        revitVersion, targetFramework, containerTypeName, executionId);

                var compilationResult = this.CompileScript(
                    plan,
                    runtimeReferenceScope.MetadataReferences,
                    resolvedProject.Usings,
                    cancellation.Token
                );
                Log.Information(
                    "Revit scripting compile completed: ExecutionId={ExecutionId}, Success={Success}, Diagnostics={DiagnosticCount}",
                    executionId,
                    compilationResult.Success,
                    compilationResult.Diagnostics.Count
                );
                foreach (var diagnostic in compilationResult.Diagnostics)
                    AppendDiagnostic(diagnostics, diagnostic);
                AppendContextNameHints(diagnostics, plan.SourceSet.EntryPointSourceName);

                if (!compilationResult.Success || compilationResult.AssemblyBytes == null) {
                    AppendAuthoringShapeHint(diagnostics, "compile", plan.SourceSet.EntryPointSourceName);
                    return CreateResult(
                        ScriptExecutionStatus.CompilationFailed,
                        outputSink,
                        diagnostics,
                        revitVersion,
                        targetFramework,
                        containerTypeName,
                        executionId
                    );
                }

                cancellation.Token.ThrowIfCancellationRequested();
                executionContext = this.BuildExecutionContext(plan, outputSink, cancellation.Token);
                var containerResult = this.InstantiateContainer(
                    compilationResult.AssemblyBytes,
                    executionContext,
                    plan,
                    runtimeReferenceScope.ResolverScope
                );
                Log.Information(
                    "Revit scripting instantiate completed: ExecutionId={ExecutionId}, Status={Status}, ContainerType={ContainerTypeName}, Diagnostics={DiagnosticCount}",
                    executionId,
                    containerResult.Status,
                    containerResult.ContainerTypeName,
                    containerResult.Diagnostics.Count
                );
                foreach (var diagnostic in containerResult.Diagnostics)
                    AppendDiagnostic(diagnostics, diagnostic);

                containerTypeName = containerResult.ContainerTypeName;
                if (containerResult.Container == null) {
                    if (containerResult.Status == ScriptExecutionStatus.Rejected)
                        AppendAuthoringShapeHint(diagnostics, "instantiate", plan.SourceSet.EntryPointSourceName);
                    return CreateResult(
                        containerResult.Status,
                        outputSink,
                        diagnostics,
                        revitVersion,
                        targetFramework,
                        containerTypeName,
                        executionId
                    );
                }

                try {
                    Log.Information(
                        "Revit scripting container execute starting: ExecutionId={ExecutionId}, ContainerType={ContainerTypeName}",
                        executionId,
                        containerTypeName
                    );
                    this.ExecuteContainer(containerResult.Container, executionContext, outputSink, plan, diagnostics);
                    Log.Information(
                        "Revit scripting container execute completed: ExecutionId={ExecutionId}, ContainerType={ContainerTypeName}",
                        executionId,
                        containerTypeName
                    );
                    return CreateResult(
                        ScriptExecutionStatus.Succeeded,
                        outputSink,
                        diagnostics,
                        revitVersion,
                        targetFramework,
                        containerTypeName,
                        executionId,
                        executionContext.Artifacts.Artifacts,
                        executionContext.ResultData
                    );
                } catch (RevitScriptMutationException ex) {
                    AppendDiagnostic(diagnostics, ScriptDiagnosticFactory.Error(
                        "mutation-monitor",
                        ex.Message,
                        containerTypeName
                    ));
                    Log.Error(
                        ex,
                        "Revit scripting read-only mutation monitor detected document changes: ExecutionId={ExecutionId}, ContainerType={ContainerTypeName}",
                        executionId,
                        containerTypeName
                    );
                    return CreateResult(
                        ScriptExecutionStatus.RuntimeFailed,
                        outputSink,
                        diagnostics,
                        revitVersion,
                        targetFramework,
                        containerTypeName,
                        executionId,
                        executionContext.Artifacts.Artifacts
                    );
                } catch (RevitScriptTransactionException ex) {
                    AppendDiagnostic(diagnostics, ScriptDiagnosticFactory.Error(
                        ex.Stage,
                        ex.Message,
                        containerTypeName
                    ));
                    Log.Error(
                        ex,
                        "Revit scripting host transaction failed: ExecutionId={ExecutionId}, ContainerType={ContainerTypeName}",
                        executionId,
                        containerTypeName
                    );
                    return CreateResult(
                        ex.Status,
                        outputSink,
                        diagnostics,
                        revitVersion,
                        targetFramework,
                        containerTypeName,
                        executionId,
                        executionContext.Artifacts.Artifacts
                    );
                } catch (OperationCanceledException) {
                    throw;
                } catch (Exception ex) {
                    AppendDiagnostic(diagnostics, ScriptDiagnosticFactory.Error(
                        "runtime",
                        ex.ToString(),
                        containerTypeName
                    ));
                    Log.Error(
                        ex,
                        "Revit scripting container execute failed: ExecutionId={ExecutionId}, ContainerType={ContainerTypeName}",
                        executionId,
                        containerTypeName
                    );
                    return CreateResult(
                        ScriptExecutionStatus.RuntimeFailed,
                        outputSink,
                        diagnostics,
                        revitVersion,
                        targetFramework,
                        containerTypeName,
                        executionId,
                        executionContext.Artifacts.Artifacts
                    );
                }
            }
        } catch (OperationCanceledException) {
            var status = cancellation.IsTimeout ? ScriptExecutionStatus.TimedOut : ScriptExecutionStatus.Cancelled;
            AppendDiagnostic(diagnostics, ScriptDiagnosticFactory.Error(
                "cancel",
                cancellation.IsTimeout
                    ? $"Script execution exceeded the {cancellation.TimeoutSeconds}s timeout and stopped at a cooperative checkpoint. Partial document changes were rolled back."
                    : "Script execution was cancelled and stopped at a cooperative checkpoint. Partial document changes were rolled back.",
                containerTypeName
            ));
            Log.Warning(
                "Revit scripting execute cancelled: ExecutionId={ExecutionId}, Status={Status}",
                executionId,
                status
            );
            return CreateResult(
                status,
                outputSink,
                diagnostics,
                revitVersion,
                targetFramework,
                containerTypeName,
                executionId,
                executionContext?.Artifacts.Artifacts,
                executionContext?.ResultData
            );
        } finally {
            Log.Information(
                "Revit scripting execute finished: ExecutionId={ExecutionId}, Diagnostics={DiagnosticCount}, OutputLength={OutputLength}",
                executionId,
                diagnostics.Count,
                outputSink.GetBufferedOutput().Length
            );
        }
    }

    private (ScriptExecutionPlan? Plan, ScriptExecutionStatus Status, IReadOnlyList<ScriptDiagnostic> Diagnostics)
        NormalizeRequest(Document? document, ExecuteRevitScriptRequest request, string executionId) {
        var diagnostics = new List<ScriptDiagnostic>();
        var uiApplication = this._uiApplicationAccessor();
        if (uiApplication == null) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "normalize",
                "No active UIApplication is available."
            ));
            return (null, ScriptExecutionStatus.Rejected, diagnostics);
        }

        var revitVersion = uiApplication.Application.VersionNumber ?? "unknown";
        var targetFramework = RevitRuntimeTargetFramework.Resolve(revitVersion);
        var runtimeAssemblyPath = RevitRuntimeTargetFramework.GetRuntimeAssemblyPath();

        var hasInlineContent = !string.IsNullOrWhiteSpace(request.ScriptContent);
        var hasSourcePath = !string.IsNullOrWhiteSpace(request.SourcePath);
        if (hasInlineContent && (hasSourcePath || request.SourceBundle is not null)) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "normalize",
                "Provide either scriptContent (inline C#) or sourcePath (a pod entrypoint), not both."
            ));
            return (null, ScriptExecutionStatus.Rejected, diagnostics);
        }

        if (!hasInlineContent && !hasSourcePath) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "normalize",
                "Provide scriptContent (inline C#) or sourcePath (a pod entrypoint)."
            ));
            return (null, ScriptExecutionStatus.Rejected, diagnostics);
        }

        try {
            ScriptInputBounds.Require(request.Input);
            RequireTargetLifetime(uiApplication, document);
            // Relative reference paths resolve against the pod's own folder, and only the host knows which home
            // holds it. An inline snippet has no pod and no authored references; its base is the pod-less runs.
            var workspaceRoot = ProductRuntimeLayout.Current.State.PodlessRunsPath;

            ScriptSourceSet sourceSet;
            ScriptWorkspaceExecutionMode executionMode;
            PodManifest? podManifest = null;
            PodReceipt? preparedAttribution = null;
            string? projectSeed = null;
            var permissionMode = request.PermissionMode ?? ScriptPermissionMode.ReadOnly;
            if (hasInlineContent) {
                sourceSet = this.MaterializeInlineSnippet(
                    request.ScriptContent,
                    request.SourceName,
                    executionId
                );
                executionMode = ScriptWorkspaceExecutionMode.InlineSnippet;
            } else {
                var bundle = request.SourceBundle
                             ?? throw new ArgumentException("A pod execution requires the host-captured sourceBundle.", nameof(request.SourceBundle));
                // The key is the caller's name for the pod: a label here, never a path native code joins.
                var preparation = ScriptPodPreparationService.Prepare(request.WorkspaceKey, bundle) switch {
                    PreparedPod prepared => prepared,
                    RefusedPod refused => throw new ArgumentException(refused.Reason, PodManifestValidator.DiagnosticStage),
                    _ => throw new InvalidOperationException("Pod preparation is prepared or refused.")
                };
                var captured = ScriptPodSourceNormalizer.Normalize(bundle, request.WorkspaceKey, request.SourcePath!);
                sourceSet = captured.SourceSet;
                executionMode = ScriptWorkspaceExecutionMode.Pod;
                podManifest = captured.Manifest;
                // The frozen manifest owns identity; the host names the absolute folder that holds it today.
                workspaceRoot = (pods ?? new ScriptPodPreparationService()).ResolveFolder(podManifest.Id);
                projectSeed = captured.ProjectSeed;
                var member = preparation.Members.Single(item => string.Equals(item.Path, sourceSet.EntryPointSourceName, StringComparison.OrdinalIgnoreCase));
                // The declared mode is the default and a declared ReadOnly is a read: the one rule every door reaches.
                permissionMode = podManifest.ModeFor(member.Path, request.PermissionMode);
                // Outcome and output references are settled when CreateResult observes the final result.
                preparedAttribution = PodReceipt.ForSavedMember(podManifest.Id, member.Path, member.Sha256, "scripting.execute", null, PodRunOutcome.Failed, [], null);
            }

            var canonicalProjectContent = this._projectGenerator.GenerateProjectContent(
                projectSeed,
                workspaceRoot,
                revitVersion,
                targetFramework,
                runtimeAssemblyPath
            );

            return (
                new ScriptExecutionPlan(
                    uiApplication,
                    document,
                    executionId,
                    revitVersion,
                    targetFramework,
                    runtimeAssemblyPath,
                    workspaceRoot,
                    permissionMode,
                    sourceSet,
                    executionMode,
                    podManifest,
                    preparedAttribution,
                    canonicalProjectContent,
                    hasInlineContent,
                    request.Input
                ),
                ScriptExecutionStatus.Succeeded,
                diagnostics
            );
        } catch (ArgumentException ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                ex.ParamName == PodManifestValidator.DiagnosticStage ? PodManifestValidator.DiagnosticStage : "normalize",
                ex.Message
            ));
            return (null, ScriptExecutionStatus.Rejected, diagnostics);
        } catch (IOException ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "normalize",
                ex.Message
            ));
            return (null, ScriptExecutionStatus.Rejected, diagnostics);
        } catch (Exception ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "normalize",
                $"Project normalization failed: {ex.Message}"
            ));
            return (null, ScriptExecutionStatus.ReferenceResolutionFailed, diagnostics);
        }
    }

    /// <summary>What the run was asked to do; the consumed source is in `files`. An inline snippet is operation input, never a pod member.</summary>
    private static object RunInputMetadata(ScriptExecutionPlan plan, ExecuteRevitScriptRequest request) => new {
        operation = "scripting.execute",
        plan.ExecutionId,
        source = plan.Attribution is { } member
            ? (object)new { kind = "pod-bundle", pod = member.PodId, path = member.MemberPath, sha256 = member.MemberSha256 }
            : new { kind = "operation", name = request.SourceName },
        plan.PermissionMode,
        target = new { document = plan.Document?.Title, plan.RevitVersion, plan.TargetFramework }
    };

    /// <summary>The authored bytes (the pod bundle, or the inline text), then the normalized sources and project that compiled.</summary>
    private static List<PodRunInputFile> RunInputFiles(ScriptExecutionPlan plan, ExecuteRevitScriptRequest request) {
        var pod = plan.Attribution?.PodId;
        var authored = request.SourceBundle is { } bundle
            ? bundle.Files.Select((file, index) => new PodRunInputFile("bundle", pod, file.Path,
                $"source/{index:D2}-{Path.GetFileName(file.Path)}", Convert.FromBase64String(file.BytesBase64)))
            : [new PodRunInputFile("inline-script", null, request.SourceName ?? "inline", "source/00-inline.csx", Encoding.UTF8.GetBytes(request.ScriptContent!))];
        return [
            .. authored,
            .. plan.SourceSet.Files.Select((file, index) => new PodRunInputFile("effective-source", pod, file.Name,
                $"effective/{index:D2}-{Path.GetFileName(file.Name)}", Encoding.UTF8.GetBytes(file.Content))),
            new PodRunInputFile("project", pod, "project.csproj", "effective/project.csproj", Encoding.UTF8.GetBytes(plan.ProjectContent))
        ];
    }

    private ScriptSourceSet MaterializeInlineSnippet(string? scriptContent, string? sourceName, string executionId) {
        if (string.IsNullOrWhiteSpace(scriptContent))
            throw new ArgumentException("ScriptContent is required for inline snippets.", nameof(scriptContent));
        if (System.Text.Encoding.UTF8.GetByteCount(scriptContent) > MaxInlineSourceBytes)
            throw new ArgumentException("Inline scriptContent may not exceed 256 KiB.", nameof(scriptContent));

        sourceName = string.IsNullOrWhiteSpace(sourceName) ? "InlineSnippet.cs" : Path.GetFileName(sourceName);
        if (!sourceName.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            sourceName += ".cs";

        var normalizedContent = this._entryPointResolver.WrapStatementBody(scriptContent);
        this.PersistInlineTrace(normalizedContent, sourceName, executionId);

        return new ScriptSourceSet([
            new ScriptSourceFile(
                sourceName,
                normalizedContent
            )
        ], sourceName);
    }

    private void PersistInlineTrace(string scriptContent, string sourceName, string executionId) {
        try {
            var traceDirectory = RevitScriptingStorageLocations.ResolveInlineTraceDirectory();
            Directory.CreateDirectory(traceDirectory);

            var timestamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss-fff");
            var fileName = $"{timestamp}-{SanitizeFileName(executionId)}-{SanitizeFileName(sourceName)}";
            File.WriteAllText(Path.Combine(traceDirectory, fileName), scriptContent);
            TrimInlineTraces(traceDirectory);
        } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException) {
            Log.Warning(ex, "Failed to persist inline script trace.");
        }
    }

    private static void TrimInlineTraces(string traceDirectory) {
        var traces = Directory.GetFiles(traceDirectory, "*.cs")
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.CreationTimeUtc)
            .ThenByDescending(file => file.Name, StringComparer.OrdinalIgnoreCase)
            .Skip(50)
            .ToList();

        foreach (var trace in traces) {
            try {
                trace.Delete();
            } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException) {
                Log.Warning(ex, "Failed to trim inline script trace {TracePath}.", trace.FullName);
            }
        }
    }

    private static string SanitizeFileName(string value) {
        var sanitized = new string(value.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '-' : ch).ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "inline" : sanitized;
    }

    private static string GetRelativePath(string relativeTo, string path) {
        var relativeToUri = new Uri(AppendDirectorySeparator(Path.GetFullPath(relativeTo)));
        var pathUri = new Uri(Path.GetFullPath(path));
        return Uri.UnescapeDataString(relativeToUri.MakeRelativeUri(pathUri).ToString())
            .Replace('/', Path.DirectorySeparatorChar);
    }

    private static string AppendDirectorySeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal) ||
        path.EndsWith(Path.AltDirectorySeparatorChar.ToString(), StringComparison.Ordinal)
            ? path
            : path + Path.DirectorySeparatorChar;

    private static string DescribeExecutionMode(ScriptWorkspaceExecutionMode executionMode) => executionMode switch {
        ScriptWorkspaceExecutionMode.InlineSnippet => "Inline snippet mode:",
        ScriptWorkspaceExecutionMode.Pod => "Pod mode:",
        _ => "Script mode:"
    };

    private static void RequireTargetLifetime(UIApplication uiApplication, Document? document) {
        if (document is not null && (!document.IsValidObject ||
            !uiApplication.Application.Documents.Cast<Document>().Any(open => open.Equals(document))))
            throw new ArgumentException("The supplied script document lifetime is no longer open.");
    }

    private static IReadOnlyList<ScriptDiagnostic> ValidatePermissionMode(ScriptExecutionPlan plan) {
        if (plan.PermissionMode == ScriptPermissionMode.ReadOnly)
            return [];

        var document = plan.Document;
        if (document == null) {
            return [
                ScriptDiagnosticFactory.Error(
                    "permission",
                    $"{plan.PermissionMode} scripts require a supplied document."
                )
            ];
        }

        if (document.IsReadOnly) {
            return [
                ScriptDiagnosticFactory.Error(
                    "permission",
                    $"{plan.PermissionMode} scripts require a writable supplied document; the supplied document is read-only."
                )
            ];
        }

        return [];
    }

    private ResolvedScriptProject ResolveProject(ScriptExecutionPlan plan) =>
        this._referenceResolver.Resolve(
            plan.ProjectContent,
            plan.WorkspaceRoot,
            plan.RevitVersion
        );

    private RuntimeReferenceScope LoadRuntimeReferences(
        ScriptExecutionPlan plan,
        ResolvedScriptProject resolvedProject,
        List<ScriptDiagnostic> diagnostics
    ) => this._assemblyLoadService.CreateScope(
        resolvedProject.CompileReferencePaths,
        resolvedProject.RuntimeReferencePaths,
        plan.RuntimeAssemblyPath,
        diagnostics
    );

    private ScriptCompilationResult CompileScript(
        ScriptExecutionPlan plan,
        IReadOnlyList<MetadataReference> metadataReferences,
        IReadOnlyList<string> projectUsings,
        CancellationToken cancellationToken
    ) => this._compilationService.Compile(
        plan.SourceSet,
        metadataReferences,
        projectUsings,
        cancellationToken
    );

    private RevitScriptContext BuildExecutionContext(
        ScriptExecutionPlan plan,
        ScriptOutputSink outputSink,
        CancellationToken cancellationToken
    ) {
        RequireTargetLifetime(plan.UiApplication, plan.Document);
        var document = plan.Document;
        var activeUiDocument = plan.UiApplication.ActiveUIDocument;
        var uiDocument = document is not null && activeUiDocument?.Document.Equals(document) == true
            ? activeUiDocument : null;
        var selection = uiDocument?.Selection.GetElementIds().ToList() ?? [];

        return new RevitScriptContext(
            plan.UiApplication,
            uiDocument,
            document,
            selection,
            plan.RevitVersion,
            outputSink.Artifacts!,
            cancellationToken,
            outputSink.WriteLine,
            this._notificationSink,
            plan.Input,
            // The folder the host named for this Pod's manifest id; an inline run has none.
            plan.ExecutionMode == ScriptWorkspaceExecutionMode.Pod ? plan.WorkspaceRoot : null
        );
    }

    private ScriptContainerResolutionResult InstantiateContainer(
        byte[] assemblyBytes,
        RevitScriptContext context,
        ScriptExecutionPlan plan,
        IScriptRuntimeScope runtimeScope
    ) {
        try {
            // Loaded through the scope's own load context, NOT Assembly.Load: only a context we
            // own can route the script's binds to freshly built dlls when the host already has
            // an older copy loaded (see IScriptRuntimeScope).
            var assembly = runtimeScope.LoadScriptAssembly(assemblyBytes);
            var containerTypes = assembly.GetTypes()
                .Where(type => !type.IsAbstract && typeof(PeScriptContainer).IsAssignableFrom(type))
                .ToList();
            if (containerTypes.Count == 0) {
                return new ScriptContainerResolutionResult(
                    ScriptExecutionStatus.Rejected,
                    null,
                    null,
                    [
                        ScriptDiagnosticFactory.Error(
                            "instantiate",
                            "No non-abstract PeScriptContainer type was found."
                        )
                    ]
                );
            }

            var entryPointTypeNames = this._entryPointResolver.ResolveEntryPointContainerTypeNames(plan.SourceSet);
            if (entryPointTypeNames.Count == 0) {
                return new ScriptContainerResolutionResult(
                    ScriptExecutionStatus.Rejected,
                    null,
                    null,
                    [
                        ScriptDiagnosticFactory.Error(
                            "instantiate",
                            $"No non-abstract PeScriptContainer type was found in {plan.SourceSet.EntryPointSourceName}.",
                            plan.SourceSet.EntryPointSourceName
                        )
                    ]
                );
            }

            if (entryPointTypeNames.Count > 1) {
                var typeNames = string.Join(", ", entryPointTypeNames);
                return new ScriptContainerResolutionResult(
                    ScriptExecutionStatus.Rejected,
                    null,
                    null,
                    [
                        ScriptDiagnosticFactory.Error(
                            "instantiate",
                            $"Multiple PeScriptContainer types were found in {plan.SourceSet.EntryPointSourceName}: {typeNames}.",
                            plan.SourceSet.EntryPointSourceName
                        )
                    ]
                );
            }

            if (plan.RequireSingleContainer && containerTypes.Count > 1) {
                var typeNames = string.Join(", ", containerTypes.Select(type => type.FullName ?? type.Name));
                return new ScriptContainerResolutionResult(
                    ScriptExecutionStatus.Rejected,
                    null,
                    null,
                    [
                        ScriptDiagnosticFactory.Error(
                            "instantiate",
                            $"Multiple PeScriptContainer types were found: {typeNames}."
                        )
                    ]
                );
            }

            var entryPointTypeName = entryPointTypeNames[0];
            var containerType = containerTypes.FirstOrDefault(type =>
                string.Equals(type.FullName, entryPointTypeName, StringComparison.Ordinal) ||
                string.Equals(type.Name, entryPointTypeName, StringComparison.Ordinal));
            if (containerType == null) {
                return new ScriptContainerResolutionResult(
                    ScriptExecutionStatus.Rejected,
                    null,
                    null,
                    [
                        ScriptDiagnosticFactory.Error(
                            "instantiate",
                            $"Entry point container '{entryPointTypeName}' was not found after compilation.",
                            plan.SourceSet.EntryPointSourceName
                        )
                    ]
                );
            }
            var instance = (PeScriptContainer?)Activator.CreateInstance(containerType);
            if (instance == null) {
                return new ScriptContainerResolutionResult(
                    ScriptExecutionStatus.Rejected,
                    containerType.FullName,
                    null,
                    [
                        ScriptDiagnosticFactory.Error(
                            "instantiate",
                            $"Could not create container '{containerType.FullName}'.",
                            containerType.FullName
                        )
                    ]
                );
            }

            instance.Context = context;
            return new ScriptContainerResolutionResult(
                ScriptExecutionStatus.Succeeded,
                containerType.FullName,
                instance,
                []
            );
        } catch (Exception ex) {
            return new ScriptContainerResolutionResult(
                ScriptExecutionStatus.RuntimeFailed,
                null,
                null,
                [
                    ScriptDiagnosticFactory.Error(
                        "instantiate",
                        ex.ToString()
                    )
                ]
            );
        }
    }

    private void ExecuteContainer(
        PeScriptContainer container,
        RevitScriptContext context,
        ScriptOutputSink outputSink,
        ScriptExecutionPlan plan,
        List<ScriptDiagnostic> diagnostics
    ) {
        using var consoleCapture = outputSink.CreateConsoleCaptureScope();
        var mode = plan.PermissionMode;
        var application = context.App.Application;
        // The op runner's monitor (Pe.Revit.Operations): one DocumentChanged subscription for calls and scripts.
        // Every mode watches: the result says what the run changed, or in ReadOnly what it would have.
        OperationMonitor.Attach(application);
        // Raised before anything is watched or run: a sibling that cannot be fenced refuses the run.
        var fence = SiblingFence.Raise(application, context.Document);
        using var window = OperationMonitor.Watch(fence, idsOf: context.Document);
        var run = new RunLedger(window, mode);
        // Revit raises this for every transaction that finishes with failures, the script's own included. It only
        // reads: a script's commit that answers RolledBack with no exception is silent everywhere else (defect D5).
        application.FailuresProcessing += run.OnFailuresProcessing;
        string? unfenced = null;
        var threw = true;
        try {
            fence.Run(() => this.ExecuteWithTransactionPolicy(container, context, plan, diagnostics, run));
            threw = false;
        } catch (Exception ex) when (ex.Message.Contains("open transaction phase", StringComparison.Ordinal)
                                     && ScriptChangeLedger.SaveRefusedWords(run.TargetHold, fence.Titles) is not null) {
            // Revit does not say which document it refused, so one sentence names every hold of the run:
            // its own document's (guard, host transaction or undo group) and the fence's siblings.
            diagnostics.Add(ScriptDiagnosticFactory.Warning("transaction", ScriptChangeLedger.SaveRefusedWords(run.TargetHold, fence.Titles)!));
            throw;
        } finally {
            application.FailuresProcessing -= run.OnFailuresProcessing;
            // The fence's own rollback may raise changes; the run's commits are fixed before it.
            run.KeepGuarded();
            unfenced = fence.Lower();
            if (run.Started) {
                var commits = run.Commits();
                var fenced = run.Fenced();
                var raised = ScriptChangeLedger.Failures(mode, run.Committed(), run.Raised);
                outputSink.Changes = ScriptChangeLedger.Changes(mode, commits, raised, run.Undo, window.Overlapped, fenced);
                outputSink.Failures = [.. raised, .. ScriptChangeLedger.FencedFailures(fenced)];
                // ReadOnly discards everything by design and WriteTransaction reports its own rollback as an error.
                if (mode == ScriptPermissionMode.NoTransaction
                    && raised.Any(failure => failure.Outcome == ScriptFailureOutcome.RolledBack))
                    diagnostics.Add(ScriptDiagnosticFactory.Warning("transaction", outputSink.Changes.Summary));
                else if (fenced.Count != 0)
                    diagnostics.Add(ScriptDiagnosticFactory.Warning("fence", ScriptChangeLedger.FencedWords(fenced)));
            }
            // The script's own exception is already on its way out; the fence's words must not be lost with it.
            if (unfenced is not null && threw)
                diagnostics.Add(ScriptDiagnosticFactory.Error("fence", unfenced));
        }

        if (unfenced is not null)
            throw new RevitScriptTransactionException(ScriptExecutionStatus.RuntimeFailed, unfenced, stage: "fence");
    }

    /// <summary>
    ///     Fences a run to its target document (D14): a transaction group is held open on every other document
    ///     that was open when the run started, and is rolled back when the run ends, whatever the mode. What the
    ///     run commits in such a sibling is discarded, so a caller needs authority over the target alone (host
    ///     <c>admitScript</c>). A document the run opens itself (EditFamily, a file it opens) was not open at the
    ///     start, has no group and stays writable. Proven on fresh Revit 2025 (2026-11-14, SiblingFenceProofTests):
    ///     groups are held on several documents at once, a sibling commits under the fence in every mode's
    ///     transaction shape and the rollback discards it, and a person's earlier unsaved edits in the sibling
    ///     stay. Revit refuses Save, SaveAs and Close on a document with a group open, so a run cannot save or
    ///     close a sibling. A refused save is explained by ScriptChangeLedger.SaveRefusedWords, which names the
    ///     run's own document's hold beside the fence's. The sibling is not left modified by the rollback, and a
    ///     person's Redo in it survives a run in every mode, even one whose sibling commit was rolled back
    ///     (attached Revit 2025, 2026-11-14; the method and verdict are in ADR 0044).
    ///     The fence is also the monitor's scope: a commit in a held sibling is observed as Discarded.
    ///     The honest limit: this bounds a script's commits, not hostile code; a script that returns with a
    ///     transaction still open on a sibling may leave a group Revit will not roll back, and the run then fails
    ///     and names that document.
    /// </summary>
    private sealed class SiblingFence : OperationScope {
        // The sandbox prefix keeps document-event consumers from treating the fence's rollback as a real change.
        private const string Name = DocumentSandbox.TransactionNamePrefix + "Pe Script Fence";
        private readonly List<(Document Document, string Title, TransactionGroup Group)> _held = [];

        private SiblingFence(Document? target) : base(target) { }

        /// <summary>The titles of the siblings held, for the result's words.</summary>
        public IReadOnlyList<string> Titles => this._held.Select(held => held.Title).ToList();

        public static SiblingFence Raise(Autodesk.Revit.ApplicationServices.Application application, Document? target) {
            var fence = new SiblingFence(target);
            foreach (Document sibling in application.Documents) {
                // Revit opens no transaction on a linked or read-only document, so a run cannot commit there.
                if ((target is not null && sibling.Equals(target)) || sibling.IsLinked || sibling.IsReadOnly) continue;
                var title = sibling.Title;
                TransactionGroup? group = null;
                try {
                    group = new TransactionGroup(sibling, Name);
                    if (group.Start() != TransactionStatus.Started)
                        throw new InvalidOperationException("the group did not start.");
                    fence._held.Add((sibling, title, group));
                } catch (Exception ex) {
                    group?.Dispose();
                    _ = fence.Lower();
                    throw new RevitScriptTransactionException(
                        ScriptExecutionStatus.Rejected,
                        $"The script was not run. A script changes only the document it runs on, and Revit would not let the run protect '{title}', which is also open: {ex.Message} Close '{title}', or run the script on a copy in its own Revit.",
                        ex,
                        "fence"
                    );
                }
            }
            return fence;
        }

        /// <summary>Runs <paramref name="work" /> with every held sibling marked as discarding, for the change monitor.</summary>
        public void Run(Action work) => this._held
            .Aggregate(work, (inner, held) => () => _ = this.Discarding(held.Document, () => { inner(); return true; }))();

        /// <summary>Rolls every sibling back. Answers null when all held, else which siblings did not and why.</summary>
        public string? Lower() {
            var failed = new List<string>();
            foreach (var (_, title, group) in this._held) {
                try {
                    var status = group.RollBack();
                    if (status != TransactionStatus.RolledBack) failed.Add($"'{title}' ({status})");
                } catch (Exception ex) {
                    failed.Add($"'{title}' ({ex.Message})");
                } finally {
                    group.Dispose();
                }
            }
            this._held.Clear();
            return failed.Count == 0 ? null
                : $"A script changes only the document it runs on, and what this run did to {string.Join(", ", failed)} could not be rolled back. Check that document before you save it; closing it without saving discards the run's changes.";
        }
    }

    private void ExecuteWithTransactionPolicy(
        PeScriptContainer container,
        RevitScriptContext context,
        ScriptExecutionPlan plan,
        List<ScriptDiagnostic> diagnostics,
        RunLedger run
    ) {
        // The name of the run's one entry in Revit's undo list.
        var undoName = $"Pe script: {Path.GetFileNameWithoutExtension(plan.SourceSet.EntryPointSourceName)}";
        if (plan.PermissionMode == ScriptPermissionMode.ReadOnly) {
            ExecuteInReadOnlyRollbackGuard(container, context, diagnostics, run);
            return;
        }

        if (plan.PermissionMode == ScriptPermissionMode.WriteTransaction) {
            this.ExecuteInHostOwnedTransaction(container, context, diagnostics, run, undoName);
            return;
        }

        // NoTransaction is explicit because it has neither rollback nor commit safety; the script or called
        // library owns any transaction boundaries it needs. The group below only merges what they commit into
        // one undo entry: it is assimilated however the script ends, so what a script committed stays committed.
        ExecuteInUndoGroup(container, context, plan, diagnostics, run, undoName);
    }

    /// <summary>
    ///     Runs a NoTransaction script inside a transaction group that is assimilated when it returns, so the
    ///     transactions it commits are one undo entry. Proven on fresh Revit 2025 (2026-11-14): a group allows
    ///     EditFamily and LoadFamily inside it and nests a script's own groups, and refuses Save and SaveAs on its
    ///     document. A script that makes such a call, or a document Revit will not open a group on, runs ungrouped
    ///     and the result says why.
    /// </summary>
    private static void ExecuteInUndoGroup(
        PeScriptContainer container,
        RevitScriptContext context,
        ScriptExecutionPlan plan,
        List<ScriptDiagnostic> diagnostics,
        RunLedger run,
        string undoName
    ) {
        TransactionGroup? group = null;
        if (ScriptChangeLedger.GroupRefusal(plan.SourceSet) is { } refused)
            run.Undo = new ScriptUndo(Ungrouped: $"the script calls {refused}, which Revit refuses inside a transaction group.");
        else if (context.Document is not { } document)
            run.Undo = new ScriptUndo(Ungrouped: "the run has no document.");
        else {
            try {
                group = new TransactionGroup(document, undoName);
                if (group.Start() != TransactionStatus.Started)
                    throw new InvalidOperationException("the group did not start.");
            } catch (Exception ex) {
                group?.Dispose();
                group = null;
                run.Undo = new ScriptUndo(Ungrouped: $"Revit refused a transaction group on this document: {ex.Message}");
            }
        }

        // A save a library makes on the grouped document is refused by Revit; ExecuteContainer says why.
        if (group is not null)
            run.TargetHold = "so that its transactions are one undo entry; a script whose own source calls Save runs ungrouped, and this call was made from a library";
        try {
            run.Execute(container);
        } finally {
            if (group is not null) {
                using (group)
                    run.Undo = CloseUndoGroup(group, undoName);
            }
        }
    }

    /// <summary>
    ///     A script that returns with a transaction still open leaves a group Revit will not merge: Assimilate
    ///     answers Error, and what the script had committed stays (fresh Revit 2025, 2026-11-14).
    /// </summary>
    private static ScriptUndo CloseUndoGroup(TransactionGroup group, string undoName) {
        try {
            var status = group.Assimilate();
            return status == TransactionStatus.Committed
                ? new ScriptUndo(undoName)
                : new ScriptUndo(Ungrouped: $"Revit did not merge the run's transactions ({status}); a script that returns with a transaction still open causes this.");
        } catch (Exception ex) {
            return new ScriptUndo(Ungrouped: $"the run's undo group could not be closed: {ex.Message}");
        }
    }

    /// <summary>One run's facts for <see cref="ScriptChangeLedger" />: the commits the monitor saw and the failures Revit raised.</summary>
    private sealed class RunLedger(OperationMonitor.Window window, ScriptPermissionMode mode) {
        private readonly List<ScriptRaisedFailure> _raised = [];
        private IReadOnlyList<ObservedChange>? _guarded;
        public IReadOnlyList<ScriptRaisedFailure> Raised => this._raised;
        public ScriptUndo Undo { get; set; } = new();
        /// <summary>Why the run's own document has a transaction or group open while the script runs; null when it has none.</summary>
        public string? TargetHold { get; set; }
        /// <summary>False while the script has not been entered: a run its guard refused changed nothing and says nothing.</summary>
        public bool Started { get; private set; }

        public void Execute(PeScriptContainer container) {
            this.Started = true;
            container.Execute();
        }

        /// <summary>Every change the run's window saw, in any document.</summary>
        public IReadOnlyList<ObservedChange> Observed => window.Changes;

        /// <summary>Fixes the run's commits before a group rolls back: the ReadOnly guard's, then the sibling fence's.</summary>
        public void KeepGuarded() => this._guarded ??= window.Changes;

        /// <summary>
        ///     What the run committed in a fenced sibling, which the fence rolls back. Sandbox churn there is left
        ///     out: its own sandbox already discarded it, and the script committed nothing.
        /// </summary>
        public IReadOnlyList<ScriptFencedCommit> Fenced() => (this._guarded ?? window.Changes)
            .Where(change => change.Discarded && !DocumentSandbox.IsSandboxTransaction(change.Transactions))
            .Select(change => new ScriptFencedCommit(change.DocumentTitle, change.Transactions, change.Added + change.Modified + change.Deleted))
            .ToList();

        /// <summary>
        ///     Commits in the run's document. A write mode leaves out sandbox churn, which was discarded; a
        ///     ReadOnly run is nothing but its guard's sandbox commit, and that is what it would have changed.
        /// </summary>
        public IReadOnlyList<ScriptCommit> Commits() => this.Kept()
            .Where(change => change.Ids is not null)
            .Select(change => new ScriptCommit(change.Transactions, change.Ids!.Added, change.Ids.Modified, change.Ids.Deleted))
            .ToList();

        /// <summary>The transaction names of every commit the run saw, in order, in any document: a failure's transaction may be a family's.</summary>
        public IReadOnlyList<IReadOnlyList<string>> Committed() => this.Kept().Select(change => change.Transactions).ToList();

        private IEnumerable<ObservedChange> Kept() => (this._guarded ?? window.Changes)
            .Where(change => mode == ScriptPermissionMode.ReadOnly || !change.Contained);

        /// <summary>Records every failure the accessor holds, in Revit's words. Answers the index of the first one recorded.</summary>
        public int Observe(FailuresAccessor accessor) {
            var first = this._raised.Count;
            var commitsBefore = this.Kept().Count();
            var transaction = accessor.GetTransactionName();
            foreach (var failure in accessor.GetFailureMessages()) {
                List<long> elements;
                try {
                    elements = failure.GetFailingElementIds().Concat(failure.GetAdditionalElementIds())
                        .Select(id => id.Value()).Distinct().OrderBy(id => id).ToList();
                } catch {
                    elements = [];
                }
                this._raised.Add(new ScriptRaisedFailure(failure.GetDescriptionText(), failure.GetSeverity().ToString(),
                    failure.GetFailureDefinitionId().Guid.ToString(), elements, transaction, commitsBefore));
            }
            return first;
        }

        /// <summary>The warnings recorded from <paramref name="first" /> on were acknowledged and their transaction went on.</summary>
        public void Dismiss(int first) {
            for (var index = first; index < this._raised.Count; index++)
                this._raised[index] = this._raised[index] with { Dismissed = true };
        }

        public void OnFailuresProcessing(object? sender, Autodesk.Revit.DB.Events.FailuresProcessingEventArgs args) {
            try {
                _ = this.Observe(args.GetFailuresAccessor());
            } catch (Exception ex) {
                Log.Warning(ex, "Script run could not read a Revit failure");
            }
        }
    }

    private const string ReadOnlyGuardTransactionName = DocumentSandbox.TransactionNamePrefix + "Pe Script ReadOnly";

    /// <summary>
    ///     ReadOnly runs inside a commit-then-rollback guard: the script executes in a transaction
    ///     that COMMITS inside a TransactionGroup that always rolls back. The inner commit is what
    ///     makes mutation detection possible — Revit raises DocumentChanged with real deltas only on
    ///     commit, never for a rolled-back transaction — while the group rollback physically discards
    ///     the changes. The sandbox name prefix keeps document-event consumers (bridge invalidation)
    ///     from treating the churn as a real change, and is also how the guard tells its own contained
    ///     churn from a genuine escape: a DocumentChanged carrying a transaction name that is NOT the
    ///     guard's (a committed transaction the group rollback does not cover — for example a change to
    ///     a document the script opened) persisted and stays a hard error; a commit in a sibling that was
    ///     already open is rolled back by <see cref="SiblingFence" /> and is no escape. Regeneration that a script's reads
    ///     force (e.g. ViewSchedule.GetTableData) raises DocumentChanged under the guard's OWN
    ///     transaction name, or with none at all, and is discarded by the group rollback — it is
    ///     contained, never a persist. Classification is by transaction NAME, never by Document
    ///     reference: Revit hands the event a different Document wrapper than context.Document, so a
    ///     reference check misreads the guard's own churn as a foreign write. If the rollback guard
    ///     cannot start, execution fails closed.
    /// </summary>
    private static void ExecuteInReadOnlyRollbackGuard(
        PeScriptContainer container,
        RevitScriptContext context,
        List<ScriptDiagnostic> diagnostics,
        RunLedger run
    ) {
        var document = context.Document ?? throw new RevitScriptTransactionException(
            ScriptExecutionStatus.Rejected,
            "ReadOnly scripts require an active writable document so their changes can be rolled back.",
            stage: "readonly"
        );
        if (document.IsReadOnly) {
            throw new RevitScriptTransactionException(
                ScriptExecutionStatus.Rejected,
                "ReadOnly scripting cannot establish its rollback guard because the active document is read-only.",
                stage: "readonly"
            );
        }

        TransactionGroup? group = null;
        Transaction? transaction = null;
        // What Revit posted inside the guard reaches the script result; a failure is rolled back silently, never shown.
        var guardFailures = new List<(bool IsError, string Message)>();
        try {
            group = new TransactionGroup(document, ReadOnlyGuardTransactionName);
            if (group.Start() != TransactionStatus.Started)
                throw new InvalidOperationException("The rollback transaction group did not start.");

            transaction = new Transaction(document, ReadOnlyGuardTransactionName);
            var failureOptions = transaction.GetFailureHandlingOptions();
            _ = failureOptions.SetFailuresPreprocessor(new DelegatingFailuresPreprocessor(accessor => {
                _ = run.Observe(accessor);
                return PeToolsFailureHandling.ResolveFailures(accessor, guardFailures);
            }));
            _ = failureOptions.SetForcedModalHandling(false);
            transaction.SetFailureHandlingOptions(failureOptions);
            if (transaction.Start() != TransactionStatus.Started)
                throw new InvalidOperationException("The rollback transaction did not start.");
        } catch (Exception ex) {
            transaction?.Dispose();
            if (group?.HasStarted() == true)
                _ = group.RollBack();
            group?.Dispose();
            throw new RevitScriptTransactionException(
                ScriptExecutionStatus.Rejected,
                $"ReadOnly rollback guard could not start; the script was not executed: {ex.Message}",
                ex,
                "readonly"
            );
        }

        run.TargetHold = "the ReadOnly rollback guard";
        try {
            run.Execute(container);
        } finally {
            try {
                // Commit fires DocumentChanged with the script's deltas so the monitor can report
                // what was discarded; the group rollback below then throws those changes away.
                if (transaction is not null && transaction.HasStarted() && !transaction.HasEnded())
                    _ = transaction.Commit();
            } catch {
                // A failed guard commit must not mask the script's own outcome; the group rollback
                // still discards everything.
            } finally {
                transaction?.Dispose();
                // What the run would have changed is what the guard just committed, read before the group discards it.
                run.KeepGuarded();
                if (group?.HasStarted() == true)
                    _ = group.RollBack();
                group?.Dispose();
            }
        }

        foreach (var (isError, message) in guardFailures)
            diagnostics.Add(isError
                ? ScriptDiagnosticFactory.Warning("readonly", message)
                : ScriptDiagnosticFactory.Info("readonly", message));

        // Classify by transaction NAME, not Document reference: Revit hands the event a different
        // Document wrapper than context.Document, so ReferenceEquals misreads the guard's own churn
        // as a foreign write (the ViewSchedule.GetTableData regen persist-false-positive). A change
        // whose name escaped the guard is a committed transaction the group rollback does not cover
        // (a document the script opened itself), so it persisted. A commit in a sibling that was open
        // when the run started is Discarded: the sibling fence rolls it back, and the result says so.
        // See ReadOnlyGuardMutationClassifier.
        var changes = run.Observed;
        if (changes.Any(change => !change.Discarded && ReadOnlyGuardMutationClassifier.EscapedGuard(change.Transactions, ReadOnlyGuardTransactionName)))
            throw new RevitScriptMutationException(
                "ReadOnly script execution changed a Revit document and the changes PERSISTED (a committed transaction the rollback guard does not cover, e.g. a document the script opened). " +
                MutationSummary(changes) +
                " Rerun with permissionMode=WriteTransaction for intentional changes."
            );

        if (changes.Count != 0)
            diagnostics.Add(ScriptDiagnosticFactory.Warning(
                "readonly",
                "ReadOnly script modified the document; all changes were rolled back and discarded. " +
                MutationSummary(changes) +
                " Rerun with permissionMode=WriteTransaction to keep changes."
            ));
    }

    /// <summary>
    ///     The single host-owned transaction on the ACTIVE document is THE constraint on family
    ///     round-trips, live-proven 3/3 in the 2026-07 mutation spike: `Document.EditFamily` throws
    ///     while the project is modifiable, `LoadFamily`-into-project throws while a txn is open on
    ///     it, and `LoadFamily`-into-famdoc SILENTLY returns false without a txn on that famdoc.
    ///     Any family round-trip must route around this (parked-transaction choreography won).
    /// </summary>
    private void ExecuteInHostOwnedTransaction(
        PeScriptContainer container,
        RevitScriptContext context,
        List<ScriptDiagnostic> diagnostics,
        RunLedger run,
        string undoName
    ) {
        var document = context.Document ?? throw new RevitScriptTransactionException(
            ScriptExecutionStatus.Rejected,
            "WriteTransaction scripts require an active writable document."
        );
        if (document.IsReadOnly) {
            throw new RevitScriptTransactionException(
                ScriptExecutionStatus.Rejected,
                "WriteTransaction scripts require a writable document; the active document is read-only."
            );
        }

        DocumentSandbox sandbox;
        try {
            // One transaction is one undo entry, named after the entrypoint.
            sandbox = DocumentSandbox.BeginCommit(document, undoName);
            run.Undo = new ScriptUndo(undoName);
            run.TargetHold = "the host's one transaction";
        } catch (Exception ex) {
            throw new RevitScriptTransactionException(
                ScriptExecutionStatus.RuntimeFailed,
                $"Failed to start the host-owned Revit transaction: {ex.Message}",
                ex
            );
        }

        // A script write may not resolve Revit errors by changing model content on its own
        // (no detach/fix/delete): capture failures, reject errors, and clear them on rollback so
        // no modal dialog blocks the external-event queue.
        var commitFailures = new List<(bool IsError, string Message)>();
        var failureOptions = sandbox.Transaction.GetFailureHandlingOptions();
        _ = failureOptions.SetFailuresPreprocessor(new DelegatingFailuresPreprocessor(accessor => {
            var first = run.Observe(accessor);
            var result = PeToolsFailureHandling.RejectErrors(accessor, commitFailures);
            // Continue means no error: every failure was a warning, acknowledged and deleted.
            if (result == FailureProcessingResult.Continue) run.Dismiss(first);
            return result;
        }));
        _ = failureOptions.SetClearAfterRollback(true);
        _ = failureOptions.SetForcedModalHandling(false);
        sandbox.Transaction.SetFailureHandlingOptions(failureOptions);

        try {
            // Sandbox dispose rolls back anything uncommitted, so a script exception propagates untouched.
            using (sandbox) {
                run.Execute(container);

                try {
                    sandbox.Complete();
                } catch (Exception ex) {
                    throw new RevitScriptTransactionException(
                        ScriptExecutionStatus.RuntimeFailed,
                        $"Failed to commit the host-owned Revit transaction: {ex.Message}",
                        ex
                    );
                }
            }
        } finally {
            foreach (var (isError, message) in commitFailures)
                diagnostics.Add(isError
                    ? ScriptDiagnosticFactory.Warning("transaction", message)
                    : ScriptDiagnosticFactory.Info("transaction", message));
        }
    }

    private static ExecuteRevitScriptData CreateResult(
        ScriptExecutionStatus status,
        ScriptOutputSink outputSink,
        IReadOnlyList<ScriptDiagnostic> diagnostics,
        string revitVersion,
        string targetFramework,
        string? containerTypeName,
        string executionId,
        IReadOnlyList<ScriptArtifactData>? artifacts = null,
        object? data = null
    ) {
        var attribution = outputSink.Attribution is null ? null : outputSink.Attribution with {
            Outcome = status switch {
                ScriptExecutionStatus.Succeeded => PodRunOutcome.Succeeded,
                ScriptExecutionStatus.Cancelled => PodRunOutcome.Cancelled,
                _ => PodRunOutcome.Failed
            },
            Reason = string.Join("; ", diagnostics.Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error).Select(diagnostic => diagnostic.Message)),
            Outputs = [.. outputSink.Artifacts?.Inputs ?? [], .. (artifacts ?? []).Select(artifact => artifact.RelativePath)]
        };
        var resultArtifacts = artifacts?.ToList() ?? [];
        var resultDiagnostics = diagnostics.ToList();
        if (attribution is not null && outputSink.Artifacts is not null) {
            try {
                resultArtifacts.Add(outputSink.Artifacts.WriteReceipt(attribution));
            } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) {
                resultDiagnostics.Add(ScriptDiagnosticFactory.Warning("pod.receipt", $"Execution finished but its receipt could not be saved: {exception.Message}"));
            }
        }
        return new(
        status,
        outputSink.GetBufferedOutput(),
        resultDiagnostics,
        revitVersion,
        targetFramework,
        containerTypeName,
        executionId,
        resultArtifacts,
        data,
        attribution,
        ScriptRunScope.Current?.Held,
        outputSink.Changes,
        outputSink.Failures
    );
    }

    private static void AppendDiagnostic(
        List<ScriptDiagnostic> diagnostics,
        ScriptDiagnostic diagnostic
    ) => diagnostics.Add(diagnostic);

    private static void AppendContextNameHints(
        List<ScriptDiagnostic> diagnostics,
        string? source = null
    ) {
        if (!diagnostics.Any(diagnostic =>
                diagnostic.Stage == "compile" &&
                diagnostic.Severity == ScriptDiagnosticSeverity.Error &&
                diagnostic.Message.Contains("'Document' is a type", StringComparison.Ordinal)))
            return;

        if (diagnostics.Any(diagnostic =>
                diagnostic.Stage == "authoring" &&
                diagnostic.Message.Contains("Use `doc` for the active Revit document", StringComparison.Ordinal)))
            return;

        diagnostics.Add(ScriptDiagnosticFactory.Warning(
            "authoring",
            "Use `doc` for the active Revit document. `Document` is the Autodesk.Revit.DB.Document type, not a script context property.",
            source
        ));
    }

    private static void AppendAuthoringShapeHint(
        List<ScriptDiagnostic> diagnostics,
        string previousStage,
        string? source = null
    ) {
        if (diagnostics.Any(diagnostic =>
                diagnostic.Stage == "authoring" && diagnostic.Message.Contains(AuthoringShapeHint, StringComparison.Ordinal)))
            return;

        diagnostics.Add(ScriptDiagnosticFactory.Warning(
            "authoring",
            $"Script authoring hint after {previousStage} failure: {AuthoringShapeHint}",
            source
        ));
    }

    private sealed class RevitScriptTransactionException(
        ScriptExecutionStatus status,
        string message,
        Exception? innerException = null,
        string stage = "transaction"
    ) : Exception(message, innerException) {
        public ScriptExecutionStatus Status { get; } = status;
        public string Stage { get; } = stage;
    }

    private sealed class RevitScriptMutationException(
        string message,
        Exception? innerException = null
    ) : Exception(message, innerException);

    private static string MutationSummary(IReadOnlyList<ObservedChange> changes) {
        static string FormatList(IEnumerable<string> values) =>
            values.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.Ordinal).ToList() is { Count: > 0 } list
                ? string.Join(", ", list) : "<none reported>";
        return
            $"Added={changes.Sum(item => item.Added)}, Modified={changes.Sum(item => item.Modified)}, Deleted={changes.Sum(item => item.Deleted)}. " +
            $"Documents={FormatList(changes.Select(item => item.DocumentTitle))}. " +
            $"Transactions={FormatList(changes.SelectMany(item => item.Transactions))}.";
    }

}
