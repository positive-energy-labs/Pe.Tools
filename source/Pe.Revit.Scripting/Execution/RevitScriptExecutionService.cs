using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Policy;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.References;
using Pe.Revit.Scripting.Storage;
using Pe.Revit.Utils;
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
    private readonly ScriptAssemblyLoadService _assemblyLoadService = assemblyLoadService;
    private readonly ScriptCompilationService _compilationService = compilationService;
    private readonly ScriptEntryPointResolver _entryPointResolver = new(nameof(PeScriptContainer));
    private readonly ScriptPolicyAnalyzer _policyAnalyzer = ScriptPolicyAnalyzer.CreateDefault();
    private readonly RevitReadOnlyMutationPolicyAnalyzer _readOnlyMutationPolicyAnalyzer = new();
    private readonly Action<string>? _notificationSink = notificationSink;
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;
    private readonly ScriptReferenceResolver _referenceResolver = referenceResolver;
    private readonly Func<UIApplication?> _uiApplicationAccessor = uiApplicationAccessor;

    private const string AuthoringShapeHint = "Inline scriptContent accepts Execute-body statements such as WriteLine(\"...\"), with optional leading using directives, or a full container class: public sealed class Script : PeScriptContainer { public override void Execute() { WriteLine(\"...\"); } }. Execute() returns void. WorkspacePath scripts are normal C# files with one PeScriptContainer. Inside Execute(), use doc, uidoc, app, selection, revitVersion, Artifacts, and WriteLine(...).";

    public ExecuteRevitScriptData Execute(
        ExecuteRevitScriptRequest request,
        string executionId
    ) {
        Log.Information(
            "Revit scripting execute starting: ExecutionId={ExecutionId}, SourceKind={SourceKind}, WorkspaceKey={WorkspaceKey}, SourcePath={SourcePath}",
            executionId,
            request.SourceKind,
            request.WorkspaceKey,
            request.SourcePath
        );

        var diagnostics = new List<ScriptDiagnostic>();
        var outputSink = new ScriptOutputSink();
        var revitVersion = "unknown";
        var targetFramework = string.Empty;
        string? containerTypeName = null;

        try {
            var planResult = this.NormalizeRequest(request, executionId);
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
            IReadOnlyList<ScriptDiagnostic> originDiagnostics = plan.PodManifest is null ? [] : PodOriginVersionGuard.Check(plan.PodManifest);
            foreach (var diagnostic in originDiagnostics)
                AppendDiagnostic(diagnostics, diagnostic);
            if (originDiagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error))
                return CreateResult(
                    ScriptExecutionStatus.Rejected,
                    outputSink,
                    diagnostics,
                    revitVersion,
                    targetFramework,
                    containerTypeName,
                    executionId
                );

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
                var readOnlyMutationDiagnostics = this.AnalyzeReadOnlyMutations(
                    plan,
                    runtimeReferenceScope.MetadataReferences,
                    resolvedProject.Usings
                );
                foreach (var diagnostic in readOnlyMutationDiagnostics)
                    AppendDiagnostic(diagnostics, diagnostic);
                if (readOnlyMutationDiagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error)) {
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

                var compilationResult = this.CompileScript(
                    plan,
                    runtimeReferenceScope.MetadataReferences,
                    resolvedProject.Usings
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

                var executionContext = this.BuildExecutionContext(plan, outputSink);
                var containerResult = this.InstantiateContainer(
                    compilationResult.AssemblyBytes,
                    executionContext,
                    plan
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
                        executionContext.Artifacts.Artifacts
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
                        "transaction",
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
        NormalizeRequest(ExecuteRevitScriptRequest request, string executionId) {
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

        try {
            var workspaceKey = ScriptingWorkspaceLayout.NormalizeWorkspaceKey(request.WorkspaceKey);
            var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
            var workspaceProjectPath = RevitScriptingStorageLocations.ResolveProjectFilePath(workspaceKey);

            ScriptSourceSet sourceSet;
            ScriptWorkspaceExecutionMode executionMode;
            PodManifest? podManifest = null;
            if (request.SourceKind == ScriptExecutionSourceKind.InlineSnippet) {
                sourceSet = this.MaterializeInlineSnippet(
                    request.ScriptContent,
                    request.SourceName,
                    executionId
                );
                executionMode = ScriptWorkspaceExecutionMode.InlineSnippet;
            } else if (request.SourceKind == ScriptExecutionSourceKind.WorkspacePath) {
                var workspaceSource = this.LoadWorkspaceSource(workspaceKey, request.SourcePath);
                foreach (var diagnostic in workspaceSource.Diagnostics)
                    diagnostics.Add(diagnostic);
                if (workspaceSource.Diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error))
                    return (null, ScriptExecutionStatus.Rejected, diagnostics);

                sourceSet = workspaceSource.SourceSet;
                executionMode = workspaceSource.ExecutionMode;
                podManifest = workspaceSource.PodManifest;
            } else {
                throw new InvalidOperationException($"Unsupported source kind '{request.SourceKind}'.");
            }

            var projectSeed = request.SourceKind == ScriptExecutionSourceKind.InlineSnippet
                ? null
                : ReadFileIfExists(workspaceProjectPath);
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
                    executionId,
                    revitVersion,
                    targetFramework,
                    runtimeAssemblyPath,
                    workspaceKey,
                    workspaceRoot,
                    request.ArtifactRunName,
                    request.PermissionMode,
                    sourceSet,
                    executionMode,
                    podManifest,
                    canonicalProjectContent,
                    request.SourceKind == ScriptExecutionSourceKind.InlineSnippet
                ),
                ScriptExecutionStatus.Succeeded,
                diagnostics
            );
        } catch (ArgumentException ex) {
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                "normalize",
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
        ScriptWorkspaceExecutionMode.LooseWorkspace => "Loose workspace mode:",
        ScriptWorkspaceExecutionMode.Pod => "Pod mode:",
        _ => "Script mode:"
    };

    private WorkspaceSourceLoadResult LoadWorkspaceSource(string workspaceKey, string? sourcePath) {
        if (string.IsNullOrWhiteSpace(sourcePath))
            throw new ArgumentException("SourcePath is required for workspace file execution.", nameof(sourcePath));

        var normalizedSourcePath = ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath, "Workspace source path");
        var selectedPath = RevitScriptingStorageLocations.ResolveWorkspaceSourceFilePath(
            workspaceKey,
            normalizedSourcePath
        );
        if (Directory.Exists(selectedPath))
            throw new ArgumentException("Workspace source path must point to a .cs file, not a directory.",
                nameof(sourcePath));
        if (!selectedPath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Workspace source path must point to a .cs file.", nameof(sourcePath));
        if (!File.Exists(selectedPath))
            throw new IOException($"Workspace source file does not exist: {selectedPath}");

        var sourceDirectory = RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey);
        if (!Directory.Exists(sourceDirectory))
            throw new IOException($"Workspace source directory does not exist: {sourceDirectory}");

        var podManifestPath = RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey);
        if (!File.Exists(podManifestPath)) {
            var looseSelectedSource = new ScriptSourceFile(
                GetRelativePath(sourceDirectory, selectedPath),
                File.ReadAllText(selectedPath),
                selectedPath
            );
            return new WorkspaceSourceLoadResult(
                new ScriptSourceSet([looseSelectedSource], looseSelectedSource.Name),
                ScriptWorkspaceExecutionMode.LooseWorkspace,
                null,
                [
                    ScriptDiagnosticFactory.Info(
                        "normalize",
                        "Loose workspace mode: no pod.json was found, so only the requested source file will be compiled and sibling files are ignored.",
                        looseSelectedSource.Name
                    )
                ]
            );
        }

        var diagnostics = new List<ScriptDiagnostic>();
        var manifestResult = PodManifestValidator.ValidateJson(File.ReadAllText(podManifestPath), workspaceKey);
        diagnostics.AddRange(manifestResult.Diagnostics);
        if (!manifestResult.Success || manifestResult.Manifest is null)
            return new WorkspaceSourceLoadResult(
                new ScriptSourceSet([], string.Empty),
                ScriptWorkspaceExecutionMode.Pod,
                null,
                diagnostics
            );

        if (!manifestResult.Manifest.Entrypoints.Any(entrypoint =>
                string.Equals(entrypoint.SourcePath, normalizedSourcePath, StringComparison.OrdinalIgnoreCase)))
            diagnostics.Add(ScriptDiagnosticFactory.Error(
                PodManifestValidator.DiagnosticStage,
                $"pod.json does not declare '{normalizedSourcePath}' as an entrypoint.",
                normalizedSourcePath
            ));
        if (diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error))
            return new WorkspaceSourceLoadResult(
                new ScriptSourceSet([], string.Empty),
                ScriptWorkspaceExecutionMode.Pod,
                null,
                diagnostics
            );

        var sourceFiles = Directory.EnumerateFiles(sourceDirectory, "*.cs", SearchOption.AllDirectories)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .Select(path => new ScriptSourceFile(
                GetRelativePath(sourceDirectory, path),
                File.ReadAllText(path),
                path
            ))
            .ToList();

        var selectedFullPath = Path.GetFullPath(selectedPath);
        var selectedSource = sourceFiles.FirstOrDefault(file =>
            file.FullPath != null && string.Equals(Path.GetFullPath(file.FullPath), selectedFullPath,
                StringComparison.OrdinalIgnoreCase));
        if (selectedSource == null)
            throw new IOException($"Workspace source file is not under src/: {selectedPath}");

        diagnostics.Add(ScriptDiagnosticFactory.Info(
            "normalize",
            "Pod mode: pod.json was validated, the requested source is a declared entrypoint, and all src/**/*.cs files will be compiled.",
            selectedSource.Name
        ));

        return new WorkspaceSourceLoadResult(
            new ScriptSourceSet(sourceFiles, selectedSource.Name),
            ScriptWorkspaceExecutionMode.Pod,
            manifestResult.Manifest,
            diagnostics
        );
    }

    private static IReadOnlyList<ScriptDiagnostic> ValidatePermissionMode(ScriptExecutionPlan plan) {
        if (plan.PermissionMode == ScriptPermissionMode.ReadOnly)
            return [];

        var document = plan.UiApplication.ActiveUIDocument?.Document;
        if (document == null) {
            return [
                ScriptDiagnosticFactory.Error(
                    "permission",
                    "WriteTransaction scripts require an active document."
                )
            ];
        }

        if (document.IsReadOnly) {
            return [
                ScriptDiagnosticFactory.Error(
                    "permission",
                    "WriteTransaction scripts require a writable active document; the active document is read-only."
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

    private IReadOnlyList<ScriptDiagnostic> AnalyzeReadOnlyMutations(
        ScriptExecutionPlan plan,
        IReadOnlyList<MetadataReference> metadataReferences,
        IReadOnlyList<string> projectUsings
    ) => plan.PermissionMode == ScriptPermissionMode.ReadOnly
        ? this._readOnlyMutationPolicyAnalyzer.Analyze(
            plan.SourceSet,
            metadataReferences,
            projectUsings
        )
        : [];

    private ScriptCompilationResult CompileScript(
        ScriptExecutionPlan plan,
        IReadOnlyList<MetadataReference> metadataReferences,
        IReadOnlyList<string> projectUsings
    ) => this._compilationService.Compile(
        plan.SourceSet,
        metadataReferences,
        projectUsings
    );

    private RevitScriptContext BuildExecutionContext(
        ScriptExecutionPlan plan,
        ScriptOutputSink outputSink
    ) {
        var uiDocument = plan.UiApplication.ActiveUIDocument;
        var document = uiDocument?.Document;
        var selection = uiDocument?.Selection.GetElementIds().ToList() ?? [];

        return new RevitScriptContext(
            plan.UiApplication,
            uiDocument,
            document,
            selection,
            plan.RevitVersion,
            new ScriptArtifactWriter(plan.ExecutionId, plan.ArtifactRunName),
            outputSink.WriteLine,
            this._notificationSink
        );
    }

    private ScriptContainerResolutionResult InstantiateContainer(
        byte[] assemblyBytes,
        RevitScriptContext context,
        ScriptExecutionPlan plan
    ) {
        try {
            var assembly = Assembly.Load(assemblyBytes);
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
            using var mutationMonitor = new ScriptDocumentMutationMonitor(context.App.Application);
            try {
                container.Execute();
            } catch (Exception ex) when (mutationMonitor.HasChanges) {
                throw new RevitScriptMutationException(mutationMonitor.CreateSummary(), ex);
            }

            if (mutationMonitor.HasChanges)
                throw new RevitScriptMutationException(mutationMonitor.CreateSummary());

            return;
        }

        this.ExecuteInHostOwnedTransaction(container, context, diagnostics);
    }

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
        _ = failureOptions.SetFailuresPreprocessor(new DialogSuppressingFailuresPreprocessor(commitFailures));
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
        IReadOnlyList<ScriptArtifactData>? artifacts = null
    ) => new(
        status,
        outputSink.GetBufferedOutput(),
        diagnostics.ToList(),
        revitVersion,
        targetFramework,
        containerTypeName,
        executionId,
        artifacts?.ToList() ?? []
    );

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

    private sealed record WorkspaceSourceLoadResult(
        ScriptSourceSet SourceSet,
        ScriptWorkspaceExecutionMode ExecutionMode,
        PodManifest? PodManifest,
        IReadOnlyList<ScriptDiagnostic> Diagnostics
    );

    private sealed class RevitScriptTransactionException(
        ScriptExecutionStatus status,
        string message,
        Exception? innerException = null
    ) : Exception(message, innerException) {
        public ScriptExecutionStatus Status { get; } = status;
    }

    private sealed class RevitScriptMutationException(
        string message,
        Exception? innerException = null
    ) : Exception(message, innerException);

    private sealed class ScriptDocumentMutationMonitor : IDisposable {
        private readonly Autodesk.Revit.ApplicationServices.Application _application;
        private readonly List<ScriptDocumentMutationEvent> _events = [];
        private bool _disposed;

        public ScriptDocumentMutationMonitor(Autodesk.Revit.ApplicationServices.Application application) {
            this._application = application ?? throw new ArgumentNullException(nameof(application));
            this._application.DocumentChanged += this.OnDocumentChanged;
        }

        public bool HasChanges => this._events.Count != 0;

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
                "ReadOnly script execution changed an open Revit document. " +
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
            this._events.Add(new ScriptDocumentMutationEvent(
                document?.Title ?? "<unknown>",
                addedCount,
                modifiedCount,
                deletedCount,
                args.GetTransactionNames().ToList()
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
        IReadOnlyList<string> TransactionNames
    );

    private static string? ReadFileIfExists(string path) =>
        File.Exists(path) ? File.ReadAllText(path) : null;
}
