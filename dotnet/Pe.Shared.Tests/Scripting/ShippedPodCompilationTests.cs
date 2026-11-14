using Microsoft.CodeAnalysis;
using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Policy;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ShippedPodCompilationTests {
    [Test]
    public void Every_first_boot_shipped_pod_entrypoint_compiles_under_its_shipped_policy() {
        var root = FindRepositoryRoot();
        var examples = Path.Combine(root, "examples", "pods");
        var references = MetadataReferences();
        var projectUsings = Array.Empty<string>();
        var compiler = new ScriptCompilationService(ScriptFileTemplates.DefaultUsings);
        var policy = ScriptPolicyAnalyzer.CreateDefault();

        foreach (var folder in Directory.EnumerateDirectories(examples).OrderBy(path => path, StringComparer.Ordinal)) {
            var bundle = Capture(folder);
            var manifest = PodManifestValidator.ValidateJson(File.ReadAllText(Path.Combine(folder, "pod.json"))).Manifest
                ?? throw new AssertionException($"Shipped Pod '{folder}' has an invalid manifest.");
            foreach (var entrypoint in manifest.Entrypoints) {
                // pod.json declares each shipped entrypoint's mode (contract C1); a shipped one never leaves it to the caller.
                Assert.That(entrypoint.Mode, Is.Not.Null,
                    $"Shipped Pod '{manifest.Id}' entrypoint '{entrypoint.SourcePath}' declares no mode in pod.json.");
                var mode = entrypoint.Mode!.Value;

                var normalized = ScriptPodSourceNormalizer.Normalize(bundle, manifest.Id, entrypoint.SourcePath);
                var selected = ScriptSourceClosure.Select(
                    normalized.SourceSet,
                    references,
                    ScriptFileTemplates.DefaultUsings.Concat(projectUsings).ToList()
                );
                var policyDiagnostics = policy.Analyze(selected, mode, references, ScriptFileTemplates.DefaultUsings.Concat(projectUsings).ToList());
                Assert.That(policyDiagnostics.Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error), Is.Empty,
                    $"Shipped Pod '{manifest.Id}' entrypoint '{entrypoint.SourcePath}' policy {mode} failed: {Diagnostics(policyDiagnostics)}");

                // The same captured writing entrypoint must fail without its explicit transaction permission.
                if (manifest.Id == "snowdon-ducts" && entrypoint.SourcePath == "src/CoefficientExperiment.cs") {
                    foreach (var denied in new[] { ScriptPermissionMode.ReadOnly, ScriptPermissionMode.WriteTransaction })
                        Assert.That(policy.Analyze(selected, denied, references, ScriptFileTemplates.DefaultUsings)
                            .Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error), Is.True,
                            $"Shipped writing entrypoint was admitted under {denied}.");
                }

                var result = compiler.Compile(selected, references, projectUsings);
                Assert.That(result.Success, Is.True,
                    $"Shipped Pod '{manifest.Id}' entrypoint '{entrypoint.SourcePath}' compile failed: {Diagnostics(result.Diagnostics)}");
            }
        }
    }

    // The bundle production hands C#: capturePackage's sourceBundle, filtered by isCompilerInput
    // (ts/apps/host/src/packages.ts): pod.json, PeScripts.csproj and every .cs and .csx member. Never the whole
    // folder: a pod that is a pnpm workspace member holds node_modules junctions into the TS workspace (~400k
    // files), so the walk skips the folders the host's capture skips.
    private static readonly HashSet<string> Debris = new(StringComparer.OrdinalIgnoreCase) {
        ".state", "output", "bin", "obj", "node_modules", ".git", ".vs", ".idea", ".cache", "cache", "dist", ".artifacts"
    };

    private static IEnumerable<string> Scripts(string directory) => Directory.EnumerateFiles(directory)
        .Where(ScriptingSourcePath.IsScript)
        .Concat(Directory.EnumerateDirectories(directory)
            .Where(child => !Debris.Contains(Path.GetFileName(child))).SelectMany(Scripts));

    private static ScriptPodSourceBundle Capture(string folder) => new(
        new[] { "pod.json", "PeScripts.csproj" }.Select(name => Path.Combine(folder, name)).Where(File.Exists)
            .Concat(Scripts(folder))
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => new ScriptPodSourceFile(
                Path.GetRelativePath(folder, path).Replace(Path.DirectorySeparatorChar, '/'),
                Convert.ToBase64String(File.ReadAllBytes(path))
            )).ToList()
    );

    private static IReadOnlyList<MetadataReference> MetadataReferences() {
        var root = FindRepositoryRoot();
        var assets = JObject.Parse(File.ReadAllText(Path.Combine(
            root, ".artifacts", "obj", "Pe.Revit.Scripting", "Debug", "project.assets.json"
        )));
        var packages = assets["project"]!["restore"]!["packagesPath"]!.Value<string>()!;
        string PackageReference(string library, string assembly) => Path.Combine(
            packages, assets["libraries"]![library]!["path"]!.Value<string>()!, "ref", "net8.0-windows7.0", assembly
        );
        var runtimePaths = new[] {
            Path.Combine(TestContext.CurrentContext.TestDirectory, "Pe.Revit.Scripting.dll"),
            Path.Combine(TestContext.CurrentContext.TestDirectory, "Pe.Shared.RevitData.dll"),
            PackageReference("Nice3point.Revit.Api.RevitAPI/2025.4.50", "RevitAPI.dll"),
            PackageReference("Nice3point.Revit.Api.RevitAPIUI/2025.4.50", "RevitAPIUI.dll")
        };
        return runtimePaths.Concat(AppDomain.CurrentDomain.GetAssemblies()
            .Where(assembly => !assembly.IsDynamic && !string.IsNullOrWhiteSpace(assembly.Location))
            .Select(assembly => assembly.Location))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(path => MetadataReference.CreateFromFile(path))
            .ToList();
    }

    private static string FindRepositoryRoot() {
        var directory = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Pe.Tools.slnx")))
            directory = directory.Parent;
        Assert.That(directory, Is.Not.Null, "Could not find the Pe.Tools repository root.");
        return directory!.FullName;
    }

    private static string Diagnostics(IEnumerable<ScriptDiagnostic> diagnostics) =>
        string.Join("; ", diagnostics.Select(diagnostic => $"{diagnostic.Source}: {diagnostic.Message}"));
}
