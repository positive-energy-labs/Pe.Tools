using Microsoft.CodeAnalysis;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
#if NET5_0_OR_GREATER
using System.Runtime.Loader;
#endif

namespace Pe.Revit.Scripting.Execution;

/// <summary>
///     Builds the per-run reference scope: what a script compiles against and what its binds
///     load at runtime. The hot-reload policy lives here and is decided by STALENESS, not by
///     what the host happens to have loaded:
///     <list type="bullet">
///         <item>Pinned assemblies (script/host contracts, Revit API) always use the host's
///         loaded copy — their types cross the script&lt;-&gt;host boundary and two loaded copies
///         of an assembly are two incompatible sets of .NET types.</item>
///         <item>Everything else uses the host copy only when it is the same build (MVID) as
///         the disk candidate; a rebuilt dll is byte-loaded fresh each run, so the file is
///         never locked and "rebuild -&gt; rerun script" just works.</item>
///         <item>The compiled script itself loads into a per-run AssemblyLoadContext so these
///         rules are consulted before the default context can silently answer with a stale
///         host copy (see ResolverSubscription.ScriptLoadContext).</item>
///     </list>
///     Compile-side references follow the same rule so compile-time and runtime always agree.
/// </summary>
public sealed class ScriptAssemblyLoadService {
    internal RuntimeReferenceScope CreateScope(
        IReadOnlyList<string> compileReferencePaths,
        IReadOnlyList<string> runtimeReferencePaths,
        string runtimeAssemblyPath,
        List<ScriptDiagnostic> diagnostics
    ) {
        var alreadyLoadedAssemblyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var runtimeResolutionState = this.BuildRuntimeResolutionState(
            runtimeReferencePaths,
            runtimeAssemblyPath,
            diagnostics,
            alreadyLoadedAssemblyNames
        );
        return new RuntimeReferenceScope(
            this.BuildMetadataReferences(
                compileReferencePaths,
                runtimeReferencePaths,
                runtimeAssemblyPath,
                diagnostics,
                alreadyLoadedAssemblyNames
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
        List<ScriptDiagnostic> diagnostics,
        ISet<string> alreadyLoadedAssemblyNames
    ) {
        var assemblyMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var probeDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
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
        List<ScriptDiagnostic> diagnostics,
        ISet<string> alreadyLoadedAssemblyNames
    ) {
        var referencePaths = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            TryAddFrameworkAssembly(referencePaths, assembly);

        AddAssemblyPath(referencePaths, runtimeAssemblyPath, diagnostics, alreadyLoadedAssemblyNames);

        foreach (var assemblyPath in compileReferencePaths)
            AddAssemblyPath(referencePaths, assemblyPath, diagnostics, alreadyLoadedAssemblyNames);

        foreach (var assemblyPath in runtimeReferencePaths)
            AddAssemblyPath(referencePaths, assemblyPath, diagnostics, alreadyLoadedAssemblyNames);

        // CreateFromFile memory-maps and holds the file handle until GC; byte-images keep freshly
        // built dev dlls rebuildable. Host-loaded files are locked by the host anyway.
        var hostLoadedPaths = new HashSet<string>(
            AppDomain.CurrentDomain.GetAssemblies()
                .Where(assembly => !assembly.IsDynamic && !string.IsNullOrWhiteSpace(assembly.Location))
                .Select(assembly => assembly.Location),
            StringComparer.OrdinalIgnoreCase
        );
        var metadataReferences = new List<MetadataReference>();
        foreach (var referencePath in referencePaths.Values.Distinct(StringComparer.OrdinalIgnoreCase)) {
            try {
                metadataReferences.Add(hostLoadedPaths.Contains(referencePath)
                    ? MetadataReference.CreateFromFile(referencePath)
                    : MetadataReference.CreateFromImage(File.ReadAllBytes(referencePath), filePath: referencePath));
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

        var loadedCandidates = AppDomain.CurrentDomain.GetAssemblies()
            .Where(assembly =>
                !assembly.IsDynamic
                && assembly.GetName().Name != null
                && assembly.GetName().Name.Equals(simpleName, StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(assembly.Location)
                && File.Exists(assembly.Location)
            )
            .ToList();
        // Single-era loader: this is 0 or 1 assembly. When two same-name copies are loaded
        // side-by-side, prefer the one the intended candidate path points at (else first) so the
        // staleness check compares against the build the caller meant, not an arbitrary namesake.
        var alreadyLoaded = loadedCandidates.FirstOrDefault(a => PathsMatch(a.Location, assemblyPath))
                            ?? loadedCandidates.FirstOrDefault();
        // Compile-time and run-time must agree: whatever path lands in this map is BOTH what the
        // script compiles against and what the resolver loads. Compiling against one build and
        // running another ends in MissingMethodException.
        if (alreadyLoaded != null && ShouldUseLoadedCopy(alreadyLoaded, assemblyPath)) {
            assemblyMap[simpleName] = alreadyLoaded.Location;
            if (alreadyLoadedAssemblyNames.Add(simpleName)) {
                diagnostics.Add(ScriptDiagnosticFactory.Info(
                    "resolve",
                    $"Using already-loaded assembly '{simpleName}' from '{alreadyLoaded.Location}'.",
                    simpleName
                ));
            }
        } else {
            if (alreadyLoaded != null && alreadyLoadedAssemblyNames.Add(simpleName)) {
                diagnostics.Add(ScriptDiagnosticFactory.Info(
                    "resolve",
                    $"Host-loaded '{simpleName}' is a different build than '{assemblyPath}'; the script will use the disk copy (hot reload).",
                    simpleName
                ));
            }
            assemblyMap[simpleName] = assemblyPath;
        }
    }

    private static void TryAddProbeDirectory(
        ISet<string> probeDirectories,
        string assemblyPath
    ) {
        var directory = Path.GetDirectoryName(assemblyPath);
        if (!string.IsNullOrWhiteSpace(directory) && Directory.Exists(directory))
            _ = probeDirectories.Add(directory);
    }

    // Types from these assemblies cross the script<->host boundary: the host hands the script a
    // PeScriptContainer context, Revit API objects, and shared contract types. In .NET, two loaded
    // copies of the same assembly are two DISTINCT sets of types ("type X is not castable to type
    // X"), so for these the script must use the exact copies the host already has — a newer build
    // on disk is deliberately ignored. Everything else may be swapped per run.
    private static readonly string[] HostPinnedAssemblyNames = [
        "Pe.Revit.Scripting",
        "Pe.Shared.Scripting",
        "Pe.Shared.HostContracts"
    ];

    private static bool IsHostPinnedAssemblyName(string assemblyName) =>
        HostPinnedAssemblyNames.Contains(assemblyName, StringComparer.OrdinalIgnoreCase)
        || assemblyName.StartsWith("RevitAPI", StringComparison.OrdinalIgnoreCase);

    // Decides the core hot-reload question: may this bind reuse the copy the host already loaded,
    // or must the script get a fresh copy read from disk? "Loaded copy" is only correct when it is
    // pinned (type identity required) or literally the same build as the disk candidate.
    private static bool ShouldUseLoadedCopy(Assembly loadedAssembly, string? diskCandidatePath) {
        var simpleName = loadedAssembly.GetName().Name ?? string.Empty;
        if (IsHostPinnedAssemblyName(simpleName) || IsFrameworkAssemblyName(simpleName))
            return true;

        // No alternative on disk to offer — the loaded copy is all there is.
        if (string.IsNullOrWhiteSpace(diskCandidatePath) || !File.Exists(diskCandidatePath))
            return true;

        // Same file the host loaded from: Windows keeps a loaded dll locked, so its content
        // cannot have changed since load. Cheap fast path that skips the MVID read.
        if (string.Equals(
                Path.GetFullPath(diskCandidatePath),
                Path.GetFullPath(loadedAssembly.Location),
                StringComparison.OrdinalIgnoreCase))
            return true;

        // MVID = a GUID the compiler stamps into every build; equal MVIDs means literally the
        // same build. Different MVID means the disk file is a different (typically rebuilt)
        // binary -> hot-reload it. Unreadable disk file -> keep the safe loaded copy.
        var diskMvid = TryReadDiskMvid(diskCandidatePath);
        return diskMvid == null || diskMvid.Value == loadedAssembly.ManifestModule.ModuleVersionId;
    }

    private static Guid? TryReadDiskMvid(string assemblyPath) {
        try {
            using var stream = File.OpenRead(assemblyPath);
            using var peReader = new PEReader(stream);
            var metadataReader = peReader.GetMetadataReader();
            return metadataReader.GetGuid(metadataReader.GetModuleDefinition().Mvid);
        } catch {
            return null;
        }
    }

    private static bool PathsMatch(string? left, string? right) {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
            return false;
        try {
            return string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
        } catch {
            return false;
        }
    }

    private static bool IsFrameworkAssemblyName(string assemblyName) =>
        assemblyName.StartsWith("System", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("Microsoft", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("mscorlib", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("netstandard", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("WindowsBase", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("PresentationCore", StringComparison.OrdinalIgnoreCase)
        || assemblyName.StartsWith("PresentationFramework", StringComparison.OrdinalIgnoreCase);

    private sealed class ResolverSubscription : IScriptRuntimeScope {
        private readonly ResolveEventHandler _appDomainHandler;
        private readonly IReadOnlyDictionary<string, string> _assemblyMap;
#if NET5_0_OR_GREATER
        private readonly Func<AssemblyLoadContext, AssemblyName, Assembly?> _loadContextHandler;
        // The script and its hot-reloaded dependencies live in this per-run context. Its Load()
        // override is consulted BEFORE the default context, which is the only way a fresh disk
        // build can beat a copy the host already loaded (the default context resolves already-
        // loaded names silently, without ever raising a Resolving event).
        private readonly ScriptLoadContext _scriptLoadContext;
#endif
        private readonly IReadOnlyList<string> _probeDirectories;
        private readonly Dictionary<string, Assembly> _scopeLoadedAssemblies = new(StringComparer.OrdinalIgnoreCase);
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
            this._scriptLoadContext = new ScriptLoadContext(this);
#endif
        }

        public Assembly LoadScriptAssembly(byte[] assemblyBytes) {
#if NET5_0_OR_GREATER
            return this._scriptLoadContext.LoadFromStream(new MemoryStream(assemblyBytes));
#else
            // .NET Framework has no load contexts; byte-loaded assemblies bind their deps via
            // AssemblyResolve (subscribed above), which applies the same staleness rules.
            return Assembly.Load(assemblyBytes);
#endif
        }

#if NET5_0_OR_GREATER
        private sealed class ScriptLoadContext(ResolverSubscription owner)
            : AssemblyLoadContext($"PeScript-{Guid.NewGuid():N}", isCollectible: true) {
            // Returning null falls through to the default context (host copies, framework);
            // returning an assembly short-circuits it. Resolve() makes that call per name.
            protected override Assembly? Load(AssemblyName assemblyName) => owner.Resolve(assemblyName);
        }
#endif

        public void Dispose() {
            if (this._disposed)
                return;

            this._disposed = true;
            AppDomain.CurrentDomain.AssemblyResolve -= this._appDomainHandler;
#if NET5_0_OR_GREATER
            AssemblyLoadContext.Default.Resolving -= this._loadContextHandler;
            this._scriptLoadContext.Unload();
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

            if (this._scopeLoadedAssemblies.TryGetValue(simpleName, out var scopeLoaded))
                return scopeLoaded;

            if (!this._assemblyMap.TryGetValue(simpleName, out var assemblyPath))
                assemblyPath = this.FindProbeAssemblyPath(simpleName);

            // A copy the host loaded from a real file wins only when it is pinned (type identity
            // crosses the script<->host boundary) or identical to the disk candidate. A stale
            // host copy loses to the rebuilt dll — that is the hot-reload path. Byte-loaded
            // copies from earlier script runs have an empty Location and never count as host
            // copies, so a previous run's version can't satisfy this run's binds.
            var loadedCandidates = AppDomain.CurrentDomain.GetAssemblies()
                .Where(assembly =>
                    !assembly.IsDynamic
                    && !string.IsNullOrWhiteSpace(assembly.Location)
                    && assembly.GetName().Name != null
                    && assembly.GetName().Name.Equals(simpleName, StringComparison.OrdinalIgnoreCase)
                )
                .ToList();
            // Prefer the loaded copy at the resolved candidate path (else first); a no-op under the
            // single-era loader, correct when same-name copies coexist.
            var alreadyLoaded = loadedCandidates.FirstOrDefault(a => PathsMatch(a.Location, assemblyPath))
                                ?? loadedCandidates.FirstOrDefault();
            if (alreadyLoaded != null && ShouldUseLoadedCopy(alreadyLoaded, assemblyPath))
                return alreadyLoaded;

            if (string.IsNullOrWhiteSpace(assemblyPath) || !File.Exists(assemblyPath))
                return null;

            try {
                // Byte-load so the dll file is never locked and each run rereads the freshly built
                // dll; the collectible per-run context becomes unloadable after execution.
                // Ceiling: dlls with native sidecars lose next-to-file probing — none exist today.
#if NET5_0_OR_GREATER
                var loaded = this._scriptLoadContext.LoadFromStream(
                    new MemoryStream(File.ReadAllBytes(assemblyPath)));
#else
                var loaded = Assembly.Load(File.ReadAllBytes(assemblyPath));
#endif
                this._scopeLoadedAssemblies[simpleName] = loaded;
                return loaded;
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
