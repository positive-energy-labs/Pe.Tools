using System.Reflection;
using Microsoft.CodeAnalysis;
using Pe.Revit.Scripting.Diagnostics;
using Pe.Shared.HostContracts.Scripting;
#if NET5_0_OR_GREATER
using System.Runtime.Loader;
#endif

namespace Pe.Revit.Scripting.Execution;

public sealed class ScriptAssemblyLoadService {
    internal RuntimeReferenceScope CreateScope(
        IReadOnlyList<string> compileReferencePaths,
        IReadOnlyList<string> runtimeReferencePaths,
        string runtimeAssemblyPath,
        List<ScriptDiagnostic> diagnostics
    ) {
        var runtimeResolutionState = BuildRuntimeResolutionState(
            runtimeReferencePaths,
            runtimeAssemblyPath,
            diagnostics
        );
        return new RuntimeReferenceScope(
            this.BuildMetadataReferences(
                compileReferencePaths,
                runtimeReferencePaths,
                runtimeAssemblyPath,
                diagnostics
            ),
            new ResolverSubscription(
                runtimeResolutionState.AssemblyMap,
                runtimeResolutionState.ProbeDirectories
            )
        );
    }

    private RuntimeResolutionState BuildRuntimeResolutionState(
        IReadOnlyList<string> assemblyPaths,
        string runtimeAssemblyPath,
        List<ScriptDiagnostic> diagnostics
    ) {
        var assemblyMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var probeDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var alreadyLoadedAssemblyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var assemblyPath in assemblyPaths) {
            if (!File.Exists(assemblyPath)) {
                diagnostics.Add(ScriptDiagnosticFactory.Error(
                    "resolve",
                    $"Assembly path does not exist: {assemblyPath}"
                ));
                continue;
            }

            AddAssemblyPath(assemblyMap, assemblyPath, diagnostics, alreadyLoadedAssemblyNames);
            TryAddProbeDirectory(probeDirectories, assemblyPath);
        }

        TryAddProbeDirectory(probeDirectories, runtimeAssemblyPath);
        return new RuntimeResolutionState(assemblyMap, probeDirectories.ToList());
    }

    private IReadOnlyList<MetadataReference> BuildMetadataReferences(
        IReadOnlyList<string> compileReferencePaths,
        IReadOnlyList<string> runtimeReferencePaths,
        string runtimeAssemblyPath,
        List<ScriptDiagnostic> diagnostics
    ) {
        var referencePaths = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var alreadyLoadedAssemblyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies()) {
            TryAddFrameworkAssembly(referencePaths, assembly);
        }

        AddAssemblyPath(referencePaths, runtimeAssemblyPath, diagnostics, alreadyLoadedAssemblyNames);

        foreach (var assemblyPath in compileReferencePaths) {
            AddAssemblyPath(referencePaths, assemblyPath, diagnostics, alreadyLoadedAssemblyNames);
        }

        foreach (var assemblyPath in runtimeReferencePaths) {
            AddAssemblyPath(referencePaths, assemblyPath, diagnostics, alreadyLoadedAssemblyNames);
        }

        var metadataReferences = new List<MetadataReference>();
        foreach (var referencePath in referencePaths.Values.Distinct(StringComparer.OrdinalIgnoreCase)) {
            try {
                metadataReferences.Add(MetadataReference.CreateFromFile(referencePath));
            } catch (Exception ex) {
                diagnostics.Add(ScriptDiagnosticFactory.Warning(
                    "resolve",
                    $"Could not create metadata reference for '{referencePath}': {ex.Message}"
                ));
            }
        }

        return metadataReferences;
    }

    private static void TryAddFrameworkAssembly(
        IDictionary<string, string> assemblyMap,
        Assembly assembly
    ) {
        if (assembly.IsDynamic)
            return;

        if (string.IsNullOrWhiteSpace(assembly.Location) || !File.Exists(assembly.Location))
            return;

        var assemblyName = assembly.GetName().Name;
        if (string.IsNullOrWhiteSpace(assemblyName) || !IsFrameworkAssemblyName(assemblyName))
            return;

        assemblyMap[assemblyName] = assembly.Location;
    }

    private static void AddAssemblyPath(
        IDictionary<string, string> assemblyMap,
        string assemblyPath,
        List<ScriptDiagnostic> diagnostics,
        ISet<string> alreadyLoadedAssemblyNames
    ) {
        if (!File.Exists(assemblyPath))
            return;

        var simpleName = Path.GetFileNameWithoutExtension(assemblyPath);
        if (string.IsNullOrWhiteSpace(simpleName))
            return;

        var alreadyLoaded = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(assembly =>
                !assembly.IsDynamic
                && assembly.GetName().Name != null
                && assembly.GetName().Name.Equals(simpleName, StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(assembly.Location)
                && File.Exists(assembly.Location)
            );
        if (alreadyLoaded != null) {
            assemblyMap[simpleName] = alreadyLoaded.Location;
            if (alreadyLoadedAssemblyNames.Add(simpleName)) {
                diagnostics.Add(ScriptDiagnosticFactory.Info(
                    "resolve",
                    $"Using already-loaded assembly '{simpleName}' from '{alreadyLoaded.Location}'.",
                    simpleName
                ));
            }
        } else {
            assemblyMap[simpleName] = assemblyPath;
        }
    }

    private static void TryAddProbeDirectory(
        ISet<string> probeDirectories,
        string assemblyPath
    ) {
        var directory = Path.GetDirectoryName(assemblyPath);
        if (!string.IsNullOrWhiteSpace(directory) && Directory.Exists(directory))
            probeDirectories.Add(directory);
    }

    private static bool IsFrameworkAssemblyName(string assemblyName) =>
        assemblyName.StartsWith("System", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("Microsoft", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("mscorlib", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("netstandard", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("WindowsBase", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("PresentationCore", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("PresentationFramework", StringComparison.OrdinalIgnoreCase);

    private sealed class ResolverSubscription : IDisposable {
        private readonly ResolveEventHandler _appDomainHandler;
        private readonly IReadOnlyDictionary<string, string> _assemblyMap;
        private readonly IReadOnlyList<string> _probeDirectories;
#if NET5_0_OR_GREATER
        private readonly Func<AssemblyLoadContext, AssemblyName, Assembly?> _loadContextHandler;
#endif
        private bool _disposed;

        public ResolverSubscription(
            IReadOnlyDictionary<string, string> assemblyMap,
            IReadOnlyList<string> probeDirectories
        ) {
            this._assemblyMap = assemblyMap;
            this._probeDirectories = probeDirectories;
            this._appDomainHandler = this.OnAssemblyResolve;
            AppDomain.CurrentDomain.AssemblyResolve += this._appDomainHandler;
#if NET5_0_OR_GREATER
            this._loadContextHandler = this.OnAssemblyResolve;
            AssemblyLoadContext.Default.Resolving += this._loadContextHandler;
#endif
        }

        public void Dispose() {
            if (this._disposed)
                return;

            this._disposed = true;
            AppDomain.CurrentDomain.AssemblyResolve -= this._appDomainHandler;
#if NET5_0_OR_GREATER
            AssemblyLoadContext.Default.Resolving -= this._loadContextHandler;
#endif
        }

        private Assembly? OnAssemblyResolve(object? sender, ResolveEventArgs args) =>
            this.Resolve(new AssemblyName(args.Name));

#if NET5_0_OR_GREATER
        private Assembly? OnAssemblyResolve(AssemblyLoadContext context, AssemblyName assemblyName) =>
            this.Resolve(assemblyName);
#endif

        private Assembly? Resolve(AssemblyName assemblyName) {
            var simpleName = assemblyName.Name;
            if (string.IsNullOrWhiteSpace(simpleName))
                return null;

            var alreadyLoaded = AppDomain.CurrentDomain.GetAssemblies()
                .FirstOrDefault(assembly =>
                    !assembly.IsDynamic
                    && assembly.GetName().Name != null
                    && assembly.GetName().Name.Equals(simpleName, StringComparison.OrdinalIgnoreCase)
                );
            if (alreadyLoaded != null)
                return alreadyLoaded;

            if (!this._assemblyMap.TryGetValue(simpleName, out var assemblyPath))
                assemblyPath = this.FindProbeAssemblyPath(simpleName);

            if (string.IsNullOrWhiteSpace(assemblyPath) || !File.Exists(assemblyPath))
                return null;

            try {
#if NET5_0_OR_GREATER
                return AssemblyLoadContext.Default.LoadFromAssemblyPath(assemblyPath);
#else
                return Assembly.LoadFrom(assemblyPath);
#endif
            } catch {
                return null;
            }
        }

        private string? FindProbeAssemblyPath(string simpleName) {
            foreach (var directory in this._probeDirectories) {
                var candidatePath = Path.Combine(directory, simpleName + ".dll");
                if (File.Exists(candidatePath))
                    return candidatePath;
            }

            return null;
        }
    }

    private sealed record RuntimeResolutionState(
        IReadOnlyDictionary<string, string> AssemblyMap,
        IReadOnlyList<string> ProbeDirectories
    );
}
