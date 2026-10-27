using Microsoft.CodeAnalysis;
using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Policy;
using Pe.Shared.Scripting.Pods;
using System.Reflection;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ShippedPodCompilationTests {
    // Keep this ledger explicit: caller policy is not stored in pod.json. It is the policy of the
    // first-boot shipped entrypoint, not an inferred property of its source text.
    private static readonly IReadOnlyDictionary<(string Pod, string Entrypoint), ScriptPermissionMode> EntrypointPolicies =
        new Dictionary<(string Pod, string Entrypoint), ScriptPermissionMode> {
            [("document-profiler", "src/MechanicalPlanCensus.cs")] = ScriptPermissionMode.ReadOnly,
            [("document-profiler", "src/Profile.cs")] = ScriptPermissionMode.ReadOnly,
            [("document-profiler", "src/DeletionExperiment.cs")] = ScriptPermissionMode.NoTransaction,
            [("document-profiler", "src/SaveVariant.cs")] = ScriptPermissionMode.NoTransaction,
            [("document-profiler", "src/ViewOpenProbe.cs")] = ScriptPermissionMode.NoTransaction,
            [("snowdon-circuits", "src/Census.cs")] = ScriptPermissionMode.ReadOnly,
            [("snowdon-circuits", "src/InspectRun.cs")] = ScriptPermissionMode.ReadOnly,
            [("snowdon-ducts", "src/Census.cs")] = ScriptPermissionMode.ReadOnly,
            [("snowdon-ducts", "src/InspectRun.cs")] = ScriptPermissionMode.ReadOnly,
            [("snowdon-ducts", "src/CoefficientExperiment.cs")] = ScriptPermissionMode.NoTransaction
        };

    [Test]
    public void Every_first_boot_shipped_pod_entrypoint_compiles_under_its_shipped_policy() => CompilePods(null);

    [Test]
    public void Document_profiler_entrypoints_compile_under_explicit_policies() => CompilePods("document-profiler");

    private static void CompilePods(string? selectedPod) {
        var root = FindRepositoryRoot();
        var examples = Path.Combine(root, "examples", "pods");
        if (selectedPod is not null)
            Assert.That(Directory.Exists(Path.Combine(examples, selectedPod)), Is.True, "Selected shipped Pod is absent.");
        var references = MetadataReferences();
        var projectUsings = Array.Empty<string>();
        var compiler = new ScriptCompilationService(ScriptFileTemplates.DefaultUsings);
        var policy = ScriptPolicyAnalyzer.CreateDefault();

        foreach (var folder in Directory.EnumerateDirectories(examples).OrderBy(path => path, StringComparer.Ordinal)) {
            if (selectedPod is not null && Path.GetFileName(folder) != selectedPod) continue;
            var bundle = Capture(folder);
            var manifest = PodManifestValidator.ValidateJson(File.ReadAllText(Path.Combine(folder, "pod.json"))).Manifest
                ?? throw new AssertionException($"Shipped Pod '{folder}' has an invalid manifest.");
            foreach (var entrypoint in manifest.Entrypoints) {
                Assert.That(EntrypointPolicies.TryGetValue((manifest.Id, entrypoint.SourcePath), out var mode), Is.True,
                    $"Shipped Pod '{manifest.Id}' entrypoint '{entrypoint.SourcePath}' has no explicit shipped policy.");

                var normalized = ScriptPodSourceNormalizer.Normalize(bundle, manifest.Id, entrypoint.SourcePath);
                var selected = ScriptSourceClosure.Select(
                    normalized.SourceSet,
                    references,
                    ScriptFileTemplates.DefaultUsings.Concat(projectUsings).ToList()
                );
                var policyDiagnostics = policy.Analyze(selected, mode, references, ScriptFileTemplates.DefaultUsings.Concat(projectUsings).ToList());
                Assert.That(policyDiagnostics.Where(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error), Is.Empty,
                    $"Shipped Pod '{manifest.Id}' entrypoint '{entrypoint.SourcePath}' policy {mode} failed: {Diagnostics(policyDiagnostics)}");

                var result = compiler.Compile(selected, references, projectUsings);
                Assert.That(result.Success, Is.True,
                    $"Shipped Pod '{manifest.Id}' entrypoint '{entrypoint.SourcePath}' compile failed: {Diagnostics(result.Diagnostics)}");
            }
        }
    }

    private static ScriptPodSourceBundle Capture(string folder) => new(
        Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
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
