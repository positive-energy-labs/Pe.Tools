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

namespace Pe.Revit.Scripting.Execution;

public sealed class RevitScriptExecutionService(
    ScriptProjectGenerator projectGenerator,
    ScriptReferenceResolver referenceResolver,
    ScriptAssemblyLoadService assemblyLoadService,
    ScriptCompilationService compilationService,
    Func<UIApplication?> uiApplicationAccessor,
    Action<string>? notificationSink = null
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

    private const string AuthoringShapeHint = "Inline scriptContent accepts Execute-body statements such as WriteLine(\"...\"), with optional leading using directives, or a full container class: public sealed class Script : PeScriptContainer { public override void Execute() { WriteLine(\"...\"); } }. Execute() returns void. Pod scripts are normal C# files with one PeScriptContainer, declared as entrypoints in pod.json. Inside Execute(), use doc, uidoc, app, selection, revitVersion, ct, Artifacts, Result(...), and WriteLine(...).";

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
            outputSink.Attribution = plan.Attribution;
            outputSink.Artifacts = new ScriptArtifactWriter(plan.ExecutionId, outputRoot:
                plan.ExecutionMode == ScriptWorkspaceExecutionMode.Pod ? Path.Combine(plan.WorkspaceRoot, "output") : null);
            revitVersion = plan.RevitVersion;
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
                $"{DescribeExecutionMode(plan.ExecutionMode)} Executing {plan.SourceSet.EntryPointSourceName}; compiling {plan.SourceSet.Files.Count} source file(s): {string.Join(", ", plan.SourceSet.Files.Select(file => file.Name))}.",
                plan.SourceSet.EntryPointSourceName
            ));

            cancellation.Token.ThrowIfCancellationRequested();
            var policyDiagnostics = this._policyAnalyzer.Analyze(plan.SourceSet, plan.PermissionMode);
            foreach (var diagnostic in policyDiagnostics)
                AppendDiagnostic(diagnostics, diagnostic);
            if (policyDiagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error)) {
                return CreateResult(
                    ScriptExecutionStatus.PolicyRejected,
                    outputSink,
                    diagnostics,
                    revitVersion,
                    targetFramework,
                    containerTypeName,
                    executionId
                );
            }

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
                    this.ExecuteContainer(containerResult.Container, executionContext, outputSink, plan.PermissionMode, diagnostics);
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
            var status = cancellation.IsTimeout ? ScriptExecutionStatus.TimedOut : ScriptExecutionStatus.Canceled;
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
                "Provide either scriptContent (inline C#) or sourcePath (a pod entrypoint under src/), not both."
            ));
            return (null, ScriptExecutionStatus.Rejected, diagnostics);
        }

        if (!hasInlineContent && !hasSourcePath) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "normalize",
                "Provide scriptContent (inline C#) or sourcePath (a pod entrypoint under src/)."
            ));
            return (null, ScriptExecutionStatus.Rejected, diagnostics);
        }

        try {
            RequireTargetLifetime(uiApplication, document);
            var workspaceKey = ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.WorkspaceKey);
            var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);


            ScriptSourceSet sourceSet;
            ScriptWorkspaceExecutionMode executionMode;
            PodManifest? podManifest = null;
            PodExecutionAttributionData? preparedAttribution = null;
            string? projectSeed = null;
            if (hasInlineContent) {
                sourceSet = this.MaterializeInlineSnippet(
                    request.ScriptContent,
                    request.SourceName,
                    executionId
                );
                executionMode = ScriptWorkspaceExecutionMode.InlineSnippet;
            } else {
                var bundle = request.SourceBundle ?? CapturePodSource(workspaceKey, request.SourcePath!);
                var prepared = new ScriptPodPreparationService().Prepare(workspaceKey, bundle);
                if (!prepared.Success)
                    throw new ArgumentException(string.Join("; ", prepared.Outcomes
                        .Where(outcome => outcome.Severity == ScriptDiagnosticSeverity.Error)
                        .Select(outcome => $"{outcome.Code} at {outcome.Location}: {outcome.Reason} {outcome.Remedy}")), PodManifestValidator.DiagnosticStage);
                var captured = ScriptPodSourceNormalizer.Normalize(bundle, workspaceKey, request.SourcePath!);
                sourceSet = captured.SourceSet;
                executionMode = ScriptWorkspaceExecutionMode.Pod;
                podManifest = captured.Manifest;
                projectSeed = captured.ProjectSeed;
                var entrypoint = podManifest.Entrypoints.Single(item => string.Equals(item.SourcePath, request.SourcePath, StringComparison.OrdinalIgnoreCase));
                diagnostics.Add(ScriptDiagnosticFactory.Info("pod.prepare", $"Prepared pod snapshot {prepared.ContentHash} for entrypoint '{entrypoint.Id}'.", request.SourcePath));
                // Outcome and output references are filled when CreateResult observes the final result.
                preparedAttribution = new PodExecutionAttributionData(
                    podManifest.Id,
                    podManifest.Version,
                    prepared.ContentHash,
                    prepared.ReleaseHash,
                    entrypoint.SourcePath,
                    "scripting.execute",
                    executionId,
                    string.Empty,
                    [],
                    []
                );
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
                    workspaceKey,
                    workspaceRoot,
                    request.PermissionMode,
                    sourceSet,
                    executionMode,
                    podManifest,
                    preparedAttribution,
                    canonicalProjectContent,
                    hasInlineContent
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

    private ScriptSourceSet MaterializeInlineSnippet(string? scriptContent, string? sourceName, string executionId) {
        if (string.IsNullOrWhiteSpace(scriptContent))
            throw new ArgumentException("ScriptContent is required for inline snippets.", nameof(scriptContent));
        if (System.Text.Encoding.UTF8.GetByteCount(scriptContent) > MaxInlineSourceBytes)
            throw new ArgumentException("Inline scriptContent may not exceed 256 KiB.", nameof(scriptContent));

        sourceName = string.IsNullOrWhiteSpace(sourceName) ? "InlineSnippet.cs" : Path.GetFileName(sourceName);
        if (!sourceName.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            sourceName += ".cs";

        var normalizedContent = NormalizeInlineSnippet(scriptContent);
        this.PersistInlineTrace(normalizedContent, sourceName, executionId);

        return new ScriptSourceSet([
            new ScriptSourceFile(
                sourceName,
                normalizedContent
            )
        ], sourceName);
    }

    private string NormalizeInlineSnippet(string scriptContent) {
        if (this._entryPointResolver.ContainsContainerDeclaration(scriptContent) || this._entryPointResolver.ContainsTypeDeclaration(scriptContent))
            return scriptContent;

        var root = CSharpSyntaxTree.ParseText(scriptContent).GetCompilationUnitRoot();
        var leadingUsings = root.Usings.Count == 0
            ? string.Empty
            : string.Join(Environment.NewLine, root.Usings.Select(item => item.ToFullString().TrimEnd())) +
              Environment.NewLine + Environment.NewLine;
        var bodyStart = root.Usings.Count == 0 ? 0 : root.Usings.Last().Span.End;
        var body = scriptContent[bodyStart..].TrimStart('\r', '\n');

        return $$"""
               {{leadingUsings}}public sealed class InlineScript : PeScriptContainer
               {
                   public override void Execute()
                   {
               {{IndentInlineSnippet(body)}}
                   }
               }
               """;
    }

    private static string IndentInlineSnippet(string scriptContent) => string.Join(
        Environment.NewLine,
        scriptContent.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').Select(line => "        " + line)
    );

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

    internal static ScriptPodSourceBundle CapturePodSource(string workspaceKey, string sourcePath, Func<string, string>? workspaceRootResolver = null) {
        var resolveWorkspaceRoot = workspaceRootResolver ?? RevitScriptingStorageLocations.ResolveWorkspaceRoot;
        var root = resolveWorkspaceRoot(workspaceKey);
        var selectedPath = Path.Combine(root, ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath).Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(selectedPath)) throw new IOException($"Workspace source file does not exist: {selectedPath}");
        var dependencies = new List<ScriptPodDependencyBundle>();
        var capturedDependencies = new HashSet<string>(StringComparer.Ordinal);
        var visiting = new HashSet<string>(StringComparer.Ordinal) { workspaceKey };
        var files = Capture(workspaceKey, includeDependencies: true);
        return new ScriptPodSourceBundle(files, dependencies);

        List<ScriptPodSourceFile> Capture(string id, bool includeDependencies) {
            var podRoot = resolveWorkspaceRoot(id);
            var manifestPath = Path.Combine(podRoot, ProductPathNames.PodManifestFileName);
            if (!File.Exists(manifestPath))
                throw new ArgumentException($"Workspace '{id}' has no pod.json.", PodManifestValidator.DiagnosticStage);
            var paths = PositiveFiles(podRoot).OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToList();
            if (paths.Count > ScriptPodSourceNormalizer.MaxFiles)
                throw new IOException($"Pod capture exceeds {ScriptPodSourceNormalizer.MaxFiles} files.");
            var bytes = 0L;
            var captured = paths.Select(path => {
                var content = Read(path);
                if ((bytes += Convert.FromBase64String(content).LongLength) > 4 * 1024 * 1024)
                    throw new IOException("Pod capture exceeds 4 MiB.");
                return new ScriptPodSourceFile(GetRelativePath(podRoot, path).Replace('\\', '/'), content);
            }).ToList();
            if (ScriptPodPreparationService.HasExactReleasedFileSet(captured.ToDictionary(
                    file => file.Path,
                    file => Convert.FromBase64String(file.BytesBase64),
                    StringComparer.OrdinalIgnoreCase)))
                return captured;
            if (!includeDependencies)
                return captured;
            var manifest = PodManifestValidator.ValidateJson(File.ReadAllText(manifestPath), id);
            if (!manifest.Success || manifest.Manifest is null)
                throw new ArgumentException(string.Join("; ", manifest.Diagnostics.Select(diagnostic => diagnostic.Message)), PodManifestValidator.DiagnosticStage);
            foreach (var requirement in manifest.Manifest.Requires) {
                if (requirement.Id == workspaceKey)
                    throw new ArgumentException($"Pod dependency '{requirement.Id}' cannot overwrite the root pod capture.", PodManifestValidator.DiagnosticStage);
                if (visiting.Contains(requirement.Id))
                    throw new ArgumentException($"Pod dependency cycle through '{requirement.Id}'.", PodManifestValidator.DiagnosticStage);
                if (!capturedDependencies.Add(requirement.Id))
                    continue;
                if (!Directory.Exists(resolveWorkspaceRoot(requirement.Id)) && captured.Any(file => file.Path == "release.json"))
                    continue;
                _ = visiting.Add(requirement.Id);
                dependencies.Add(new ScriptPodDependencyBundle(requirement.Id, requirement.ReleaseHash, Capture(requirement.Id, true)));
                _ = visiting.Remove(requirement.Id);
            }
            return captured;
        }

        string Read(string path) {
            if (new FileInfo(path).Length > ScriptPodSourceNormalizer.MaxFileBytes)
                throw new IOException("Pod file exceeds 512 KiB.");
            var bytes = File.ReadAllBytes(path);
            if (bytes.Length > ScriptPodSourceNormalizer.MaxFileBytes)
                throw new IOException("Pod file exceeds 512 KiB.");
            return Convert.ToBase64String(bytes);
        }

        static IEnumerable<string> PositiveFiles(string root) {
            foreach (var name in new[] { "pod.json", "release.json", "PeScripts.csproj" }) {
                var path = Path.Combine(root, name);
                if (File.Exists(path)) yield return path;
            }
            var directoryCount = 1;
            foreach (var name in new[] { "src", "settings", "composed", "assets", "inspection" }) {
                var directory = Path.Combine(root, name);
                if (!Directory.Exists(directory)) continue;
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException($"Pod input directory cannot be a link: {name}");
                var pending = new Stack<string>();
                pending.Push(directory);
                while (pending.Count > 0) {
                    var current = pending.Pop();
                    if (++directoryCount > 256) throw new IOException("Pod directory limit exceeded.");
                    foreach (var child in Directory.EnumerateDirectories(current)) {
                        if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) != 0)
                            throw new IOException($"Pod input directory cannot be a link: {GetRelativePath(root, child)}");
                        pending.Push(child);
                    }
                    foreach (var path in Directory.EnumerateFiles(current))
                        yield return path;
                }
            }
        }
    }

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
            this._notificationSink
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
        ScriptPermissionMode permissionMode,
        List<ScriptDiagnostic> diagnostics
    ) {
        using var consoleCapture = outputSink.CreateConsoleCaptureScope();
        this.ExecuteWithTransactionPolicy(container, context, permissionMode, diagnostics);
    }

    private void ExecuteWithTransactionPolicy(
        PeScriptContainer container,
        RevitScriptContext context,
        ScriptPermissionMode permissionMode,
        List<ScriptDiagnostic> diagnostics
    ) {
        if (permissionMode == ScriptPermissionMode.ReadOnly) {
            ExecuteInReadOnlyRollbackGuard(container, context, diagnostics);
            return;
        }

        if (permissionMode == ScriptPermissionMode.WriteTransaction) {
            this.ExecuteInHostOwnedTransaction(container, context, diagnostics);
            return;
        }

        // SaveAs and a few other Revit APIs require a quiescent document and reject any open
        // transaction. NoTransaction is explicit because it has neither rollback nor commit safety;
        // the script or called library owns any transaction boundaries it needs.
        container.Execute();
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
    ///     another open document) persisted and stays a hard error. Regeneration that a script's reads
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
        List<ScriptDiagnostic> diagnostics
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
        try {
            group = new TransactionGroup(document, ReadOnlyGuardTransactionName);
            if (group.Start() != TransactionStatus.Started)
                throw new InvalidOperationException("The rollback transaction group did not start.");

            transaction = new Transaction(document, ReadOnlyGuardTransactionName);
            var failureOptions = transaction.GetFailureHandlingOptions();
            _ = failureOptions.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor([]));
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

        using var mutationMonitor = new ScriptDocumentMutationMonitor(context.App.Application);

        try {
            container.Execute();
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
                if (group?.HasStarted() == true)
                    _ = group.RollBack();
                group?.Dispose();
            }
        }

        if (mutationMonitor.HasPersistedChanges)
            throw new RevitScriptMutationException(
                "ReadOnly script execution changed an open Revit document and the changes PERSISTED (a committed transaction the rollback guard does not cover, e.g. another open document). " +
                mutationMonitor.CreateSummary() +
                " Rerun with permissionMode=WriteTransaction for intentional changes."
            );

        if (mutationMonitor.HasChanges)
            diagnostics.Add(ScriptDiagnosticFactory.Warning(
                "readonly",
                "ReadOnly script modified the document; all changes were rolled back and discarded. " +
                mutationMonitor.CreateSummary() +
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
        List<ScriptDiagnostic> diagnostics
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
            sandbox = DocumentSandbox.BeginCommit(document, "Pe Script Execution");
        } catch (Exception ex) {
            throw new RevitScriptTransactionException(
                ScriptExecutionStatus.RuntimeFailed,
                $"Failed to start the host-owned Revit transaction: {ex.Message}",
                ex
            );
        }

        // Suppress modal failure dialogs on commit: warnings and auto-resolvable errors are captured
        // as diagnostics instead of freezing the external-event queue behind a dialog.
        var commitFailures = new List<(bool IsError, string Message)>();
        var failureOptions = sandbox.Transaction.GetFailureHandlingOptions();
        _ = failureOptions.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(commitFailures));
        _ = failureOptions.SetForcedModalHandling(false);
        sandbox.Transaction.SetFailureHandlingOptions(failureOptions);

        try {
            // Sandbox dispose rolls back anything uncommitted, so a script exception propagates untouched.
            using (sandbox) {
                container.Execute();

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
            Outcome = status.ToString(),
            Reason = string.Join("; ", diagnostics.Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error).Select(diagnostic => diagnostic.Message)),
            Outputs = [
                .. (artifacts ?? []).Select(artifact => new ScriptOutputReferenceData("artifact", artifact.RelativePath))
            ]
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
        attribution
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

    private sealed class ScriptDocumentMutationMonitor : IDisposable {
        private readonly Autodesk.Revit.ApplicationServices.Application _application;
        private readonly List<ScriptDocumentMutationEvent> _events = [];
        private bool _disposed;

        public ScriptDocumentMutationMonitor(
            Autodesk.Revit.ApplicationServices.Application application
        ) {
            this._application = application ?? throw new ArgumentNullException(nameof(application));
            this._application.DocumentChanged += this.OnDocumentChanged;
        }

        public bool HasChanges => this._events.Count != 0;

        /// <summary>A change carrying a transaction name that is not the guard's — a committed
        /// transaction the group rollback does not cover (e.g. another open document), so it persisted.
        /// Regeneration a script's reads force carries the guard's own name (or none) and is contained,
        /// so it never counts here.</summary>
        public bool HasPersistedChanges => this._events.Any(item => !item.IsSandboxChurn);

        public void Dispose() {
            if (this._disposed)
                return;

            this._disposed = true;
            this._application.DocumentChanged -= this.OnDocumentChanged;
        }

        public string CreateSummary() {
            var events = this._events.ToList();
            var totalAdded = events.Sum(item => item.AddedCount);
            var totalModified = events.Sum(item => item.ModifiedCount);
            var totalDeleted = events.Sum(item => item.DeletedCount);
            var documentNames = events
                .Select(item => item.DocumentTitle)
                .Where(title => !string.IsNullOrWhiteSpace(title))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var transactionNames = events
                .SelectMany(item => item.TransactionNames)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.Ordinal)
                .ToList();

            return
                $"Added={totalAdded}, Modified={totalModified}, Deleted={totalDeleted}. " +
                $"Documents={FormatList(documentNames)}. " +
                $"Transactions={FormatList(transactionNames)}.";
        }

        private void OnDocumentChanged(object? sender, DocumentChangedEventArgs args) {
            var addedCount = args.GetAddedElementIds().Count;
            var modifiedCount = args.GetModifiedElementIds().Count;
            var deletedCount = args.GetDeletedElementIds().Count;
            if (addedCount == 0 && modifiedCount == 0 && deletedCount == 0)
                return;

            var document = args.GetDocument();
            var transactionNames = args.GetTransactionNames().ToList();
            // Classify by transaction NAME, not Document reference: Revit hands the event a different
            // Document wrapper than context.Document, so ReferenceEquals misreads the guard's own churn
            // as a foreign write (the ViewSchedule.GetTableData regen persist-false-positive). See
            // ReadOnlyGuardMutationClassifier for the full contract.
            var escapedGuard = ReadOnlyGuardMutationClassifier.EscapedGuard(
                transactionNames, ReadOnlyGuardTransactionName);
            this._events.Add(new ScriptDocumentMutationEvent(
                document?.Title ?? "<unknown>",
                addedCount,
                modifiedCount,
                deletedCount,
                transactionNames,
                IsSandboxChurn: !escapedGuard
            ));
        }

        private static string FormatList(IReadOnlyList<string> values) =>
            values.Count == 0 ? "<none reported>" : string.Join(", ", values);
    }

    private sealed record ScriptDocumentMutationEvent(
        string DocumentTitle,
        int AddedCount,
        int ModifiedCount,
        int DeletedCount,
        IReadOnlyList<string> TransactionNames,
        bool IsSandboxChurn
    );

}
