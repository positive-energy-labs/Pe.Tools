using System.Reflection;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.CodeAnalysis;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Diagnostics;
using Pe.Revit.Scripting.References;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using Serilog;

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
    private readonly Action<string>? _notificationSink = notificationSink;
    private readonly ScriptProjectGenerator _projectGenerator = projectGenerator;
    private readonly ScriptReferenceResolver _referenceResolver = referenceResolver;
    private readonly Func<UIApplication?> _uiApplicationAccessor = uiApplicationAccessor;

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
        string revitVersion = "unknown";
        string targetFramework = string.Empty;
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
                "Revit scripting plan ready: ExecutionId={ExecutionId}, RevitVersion={RevitVersion}, TargetFramework={TargetFramework}, SourceFiles={SourceFileCount}",
                executionId,
                revitVersion,
                targetFramework,
                plan.SourceSet.Files.Count
            );

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
            if (diagnostics.Any(diagnostic => diagnostic.Stage == "resolve" && diagnostic.Severity == ScriptDiagnosticSeverity.Error)) {
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
                var compilationResult = this.CompileScript(plan, runtimeReferenceScope.MetadataReferences);
                Log.Information(
                    "Revit scripting compile completed: ExecutionId={ExecutionId}, Success={Success}, Diagnostics={DiagnosticCount}",
                    executionId,
                    compilationResult.Success,
                    compilationResult.Diagnostics.Count
                );
                foreach (var diagnostic in compilationResult.Diagnostics)
                    AppendDiagnostic(diagnostics, diagnostic);

                if (!compilationResult.Success || compilationResult.AssemblyBytes == null) {
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
                    executionContext
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
                    this.ExecuteContainer(containerResult.Container, executionContext, outputSink);
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
                        executionId
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
                        executionId
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
        var workspaceKey = string.IsNullOrWhiteSpace(request.WorkspaceKey) ? "default" : request.WorkspaceKey;
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var workspaceProjectPath = RevitScriptingStorageLocations.ResolveProjectFilePath(workspaceKey);

        try {
            var sourceSet = request.SourceKind switch {
                ScriptExecutionSourceKind.InlineSnippet => this.MaterializeInlineSnippet(workspaceKey, request.ScriptContent),
                ScriptExecutionSourceKind.WorkspacePath => this.LoadWorkspaceSource(workspaceKey, request.SourcePath),
                _ => throw new InvalidOperationException($"Unsupported source kind '{request.SourceKind}'.")
            };

            if (sourceSet.Files.Count != 1) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(
                    "normalize",
                    $"Exactly one user source file is required. Found {sourceSet.Files.Count}."
                ));
                return (null, ScriptExecutionStatus.Rejected, diagnostics);
            }

            var projectSeed = request.ProjectContent ?? ReadFileIfExists(workspaceProjectPath);
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
                    sourceSet,
                    canonicalProjectContent
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

    private ScriptSourceSet MaterializeInlineSnippet(string workspaceKey, string? scriptContent) {
        if (string.IsNullOrWhiteSpace(scriptContent))
            throw new ArgumentException("ScriptContent is required for inline snippets.", nameof(scriptContent));

        var fullPath = RevitScriptingStorageLocations.ResolveLastInlineScriptPath(workspaceKey);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        File.WriteAllText(fullPath, scriptContent);

        return new ScriptSourceSet([
            new ScriptSourceFile(
                Path.GetFileName(fullPath),
                scriptContent,
                fullPath
            )
        ]);
    }

    private ScriptSourceSet LoadWorkspaceSource(string workspaceKey, string? sourcePath) {
        var fullPath = RevitScriptingStorageLocations.ResolveWorkspaceSourceFilePath(
            workspaceKey,
            sourcePath ?? throw new ArgumentException("SourcePath is required for workspace file execution.", nameof(sourcePath))
        );
        if (Directory.Exists(fullPath))
            throw new ArgumentException("Workspace source path must point to a .cs file, not a directory.", nameof(sourcePath));
        if (!fullPath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Workspace source path must point to a .cs file.", nameof(sourcePath));
        if (!File.Exists(fullPath))
            throw new IOException($"Workspace source file does not exist: {fullPath}");

        return new ScriptSourceSet([
            new ScriptSourceFile(
                Path.GetFileName(fullPath),
                File.ReadAllText(fullPath),
                fullPath
            )
        ]);
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
        IReadOnlyList<MetadataReference> metadataReferences
    ) => this._compilationService.Compile(
        plan.SourceSet,
        metadataReferences
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
            outputSink.WriteLine,
            this._notificationSink
        );
    }

    private ScriptContainerResolutionResult InstantiateContainer(
        byte[] assemblyBytes,
        RevitScriptContext context
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

            if (containerTypes.Count > 1) {
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

            var containerType = containerTypes[0];
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
        ScriptOutputSink outputSink
    ) {
        using var consoleCapture = outputSink.CreateConsoleCaptureScope();
        this.ExecuteWithTransactionPolicy(container, context);
    }

    private void ExecuteWithTransactionPolicy(PeScriptContainer container, RevitScriptContext context) {
        if (context.Document == null) {
            container.Execute();
            return;
        }

        try {
            using var transaction = new Transaction(context.Document, "Pe Script Execution");
            _ = transaction.Start();
            container.Execute();
            _ = transaction.Commit();
        } catch (Exception ex) when (IsNestedTransactionConflict(ex)) {
            container.Execute();
        }
    }

    private static ExecuteRevitScriptData CreateResult(
        ScriptExecutionStatus status,
        ScriptOutputSink outputSink,
        IReadOnlyList<ScriptDiagnostic> diagnostics,
        string revitVersion,
        string targetFramework,
        string? containerTypeName,
        string executionId
    ) => new(
        status,
        outputSink.GetBufferedOutput(),
        diagnostics.ToList(),
        revitVersion,
        targetFramework,
        containerTypeName,
        executionId
    );

    private static void AppendDiagnostic(
        List<ScriptDiagnostic> diagnostics,
        ScriptDiagnostic diagnostic
    ) => diagnostics.Add(diagnostic);

    private static bool IsNestedTransactionConflict(Exception ex) =>
        ex.Message.Contains("Starting a new transaction is not permitted", StringComparison.OrdinalIgnoreCase)
        || ex.Message.Contains("transaction already started", StringComparison.OrdinalIgnoreCase)
        || ex.Message.Contains("cannot start a new transaction", StringComparison.OrdinalIgnoreCase);

    private static string? ReadFileIfExists(string path) =>
        File.Exists(path) ? File.ReadAllText(path) : null;
}
