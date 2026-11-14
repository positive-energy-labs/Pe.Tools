using Microsoft.CodeAnalysis;
using Newtonsoft.Json;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Pods;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.References;
using System.Reflection;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ScriptPodSourceTests {
    private static string Encode(string content) => Convert.ToBase64String(Encoding.UTF8.GetBytes(content));
    private static ScriptPodSourceBundle Bundle() => new(
        [new("pod.json", Encode("""{"schemaVersion":2,"id":"sample","name":"Sample","version":"1.0.0","entrypoints":[{"sourcePath":"src/Main.cs"}]}""")),
         new("src/Main.cs", Encode("public static class Main { public static int Run() => Helper.Value; }")),
         new("src/Helper.cs", Encode("public static class Helper { public const int Value = 42; }"))]);

    // Contract C1. Mutants, each run red once: restore `file.Key.StartsWith("src/")` in the normalizer's source
    // filter (the entrypoint is "lacking"); drop the `WrapStatementBody` call (no `InlineScript` type compiles);
    // drop the `IsStatementBody` skip (the second statement body breaks the compile).
    [Test]
    public void A_statement_body_entrypoint_beside_its_page_compiles_with_the_pods_other_cs_files() {
        var bundle = new ScriptPodSourceBundle(
            [new("pod.json", Encode("""{"schemaVersion":2,"id":"sample","name":"Sample","version":"1.0.0","entrypoints":[{"sourcePath":"pages/tour/checks/census.csx"},{"sourcePath":"pages/tour/checks/other.csx"}]}""")),
             new("pages/tour/checks/census.csx", Encode("using System.Linq;\nvar total = Helper.Values.Sum();\nAnswer = total;")),
             new("pages/tour/checks/other.csx", Encode("Answer = 1;")),
             new("lib/Helper.cs", Encode("public static class Helper { public static readonly int[] Values = [40, 2]; }")),
             new("lib/Base.cs", Encode("public abstract class PeScriptContainer { public int Answer; public abstract void Execute(); }"))]);

        var normalized = ScriptPodSourceNormalizer.Normalize(bundle, "sample", "pages/tour/checks/census.csx");
        var compiled = new ScriptCompilationService([]).Compile(normalized.SourceSet,
            [.. new[] { typeof(object), typeof(Enumerable) }.Select(type => MetadataReference.CreateFromFile(type.Assembly.Location)),
             MetadataReference.CreateFromFile(Path.Combine(Path.GetDirectoryName(typeof(object).Assembly.Location)!, "System.Runtime.dll"))], []);

        Assert.That(compiled.Success, Is.True, string.Join("; ", compiled.Diagnostics.Select(d => d.Message)));
        Assert.That(normalized.SourceSet.EntryPointSourceName, Is.EqualTo("pages/tour/checks/census.csx"));
        Assert.That(normalized.SourceSet.Files.Select(f => f.Name), Is.EquivalentTo(new[] { "pages/tour/checks/census.csx", "lib/Helper.cs", "lib/Base.cs" }));
        dynamic script = Activator.CreateInstance(Assembly.Load(compiled.AssemblyBytes!).GetType("InlineScript")!)!;
        script.Execute();
        Assert.That((int)script.Answer, Is.EqualTo(42));
    }

    private static void CompileAndRun(ScriptPodSourceBundle bundle) {
        var normalized = ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs");
        var compiled = new ScriptCompilationService([]).Compile(normalized.SourceSet,
            [MetadataReference.CreateFromFile(typeof(object).Assembly.Location)], []);
        Assert.That(compiled.Success, Is.True, string.Join("; ", compiled.Diagnostics.Select(d => d.Message)));
        var assembly = Assembly.Load(compiled.AssemblyBytes!);
        Assert.That(assembly.GetType("Main")!.GetMethod("Run")!.Invoke(null, null), Is.EqualTo(42));
        Assert.That(normalized.SourceSet.EntryPointSourceName, Is.EqualTo("src/Main.cs"));
        Assert.That(normalized.SourceSet.Files.All(f => f.FullPath is null), Is.True);
    }

    [Test]
    public void Captured_set_compiles_without_a_workspace_or_materialization() => CompileAndRun(Bundle());

    [Test]
    public void Unrelated_asset_does_not_consume_compiler_source_bounds() => CompileAndRun(Bundle() with {
        Files = [.. Bundle().Files, new("assets/image.bin", Convert.ToBase64String(new byte[614400]))]
    });

    [Test]
    public void Four_MiB_of_CSharp_sources_compile_with_manifest_outside_the_source_budget() {
        var bundle = Bundle();
        var padding = new string(' ', 512 * 1024);
        CompileAndRun(bundle with { Files = [bundle.Files[0],
            .. bundle.Files.Skip(1).Select(file => file with { BytesBase64 = Encode(Encoding.UTF8.GetString(Convert.FromBase64String(file.BytesBase64)).PadRight(512 * 1024)) }),
            .. Enumerable.Range(0, 6).Select(i => new ScriptPodSourceFile($"src/Padding{i}.cs", Encode(padding)))] });
    }

    [Test]
    public void A_manifest_without_entrypoints_can_execute_a_captured_source() {
        var bundle = Bundle();
        bundle.Files[0] = new("pod.json", Convert.ToBase64String(Encoding.UTF8.GetBytes(
            """{"schemaVersion":2,"id":"sample","name":"Sample","version":"1"}""")));
        CompileAndRun(bundle);
    }

    [Test]
    public void Captured_relative_reference_compiles_against_original_root_with_a_real_dll() {
        var root = Path.Combine(Path.GetTempPath(), "pod-reference-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "lib", "2025"));
        try {
            var compiler = new ScriptCompilationService([]);
            var core = MetadataReference.CreateFromFile(typeof(object).Assembly.Location);
            var helper = compiler.Compile(new ScriptSourceSet([new("Helper.cs", "public static class Helper { public const int Value = 42; }")], "Helper.cs"), [core], []);
            Assert.That(helper.Success, Is.True);
            var dll = Path.Combine(root, "lib", "2025", "Local.dll");
            File.WriteAllBytes(dll, helper.AssemblyBytes!);
            var seed = "<Project><ItemGroup><Reference Include=\"Local\"><HintPath>lib\\$(RevitYear)\\Local.dll</HintPath></Reference></ItemGroup></Project>";
            var bundle = Bundle() with { Files = [Bundle().Files[0], Bundle().Files[1], new("PeScripts.csproj", Encode(seed))] };
            var normalized = ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs");
            var reader = new CsProjReader();
            var canonical = new ScriptProjectGenerator(reader).GenerateProjectContent(normalized.ProjectSeed, root, "2025", "net8.0-windows", typeof(ScriptProjectGenerator).Assembly.Location);
            var resolved = new ScriptReferenceResolver(reader).Resolve(canonical, root, "2025");
            Assert.That(resolved.CompileReferencePaths, Does.Contain(dll));
            var compiled = compiler.Compile(normalized.SourceSet, [core, MetadataReference.CreateFromFile(dll)], []);
            Assert.That(compiled.Success, Is.True, string.Join("; ", compiled.Diagnostics.Select(d => d.Message)));
            Assert.That(Assembly.Load(compiled.AssemblyBytes!).GetType("Main")!.GetMethod("Run")!.Invoke(null, null), Is.EqualTo(42));
        } finally { Directory.Delete(root, true); }
    }

    [Test]
    public void Actual_host_journal_seal_is_consumed_by_native_normalizer_and_compiler() {
        var path = Environment.GetEnvironmentVariable("PE_SCRIPT_BUNDLE_PROOF");
        if (path is null) Assert.Ignore("Set PE_SCRIPT_BUNDLE_PROOF to the actual host gateway proof output.");
        var request = JsonConvert.DeserializeObject<ExecuteRevitScriptRequest>(File.ReadAllText(path!))!;
        Assert.That(request.WorkspaceKey, Is.EqualTo("sample"));
        Assert.That(request.SourcePath, Is.EqualTo("src/Main.cs"));
        CompileAndRun(request.SourceBundle!);
    }

    [Test]
    public void Bom_project_absence_and_reference_declarations_are_preserved() {
        var bundle = Bundle();
        var source = "public static class Helper { public const int Value = 42; }";
        bundle.Files[2] = new("src/Helper.cs", Convert.ToBase64String(Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(source)).ToArray()));
        CompileAndRun(bundle);
        Assert.That(ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs").ProjectSeed, Is.Null);
        var project = "<Project><ItemGroup><Reference Include=\"Local\"><HintPath>lib\\$(RevitYear)\\Local.dll</HintPath></Reference></ItemGroup></Project>";
        var captured = bundle with { Files = [.. bundle.Files, new("PeScripts.csproj", Encode(project))] };
        Assert.That(ScriptPodSourceNormalizer.Normalize(captured, "sample", "src/Main.cs").ProjectSeed, Is.EqualTo(project));
    }

    [Test]
    public void Captured_manifest_reads_through_the_same_utf8_bom_seam_as_preparation() {
        var bundle = Bundle();
        var json = Convert.FromBase64String(bundle.Files[0].BytesBase64);
        bundle.Files[0] = new("pod.json", Convert.ToBase64String(new byte[] { 0xEF, 0xBB, 0xBF }.Concat(json).ToArray()));
        CompileAndRun(bundle);
        // UTF-16 was admitted by the old StreamReader path but never by preparation; both now refuse it.
        bundle.Files[0] = new("pod.json", Convert.ToBase64String(Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(Encoding.UTF8.GetString(json))).ToArray()));
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs"));
    }

    [TestCase("../Main.cs")]
    [TestCase("src/../Main.cs")]
    [TestCase("C:/Main.cs")]
    [TestCase("src/Main.txt")]
    [TestCase("src//Main.cs")]
    public void Invalid_paths_are_refused(string path) {
        var bundle = Bundle();
        bundle.Files[1] = bundle.Files[1] with { Path = path };
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs"));
    }

    // Mutants, each run red once. Drop the pod.json check in `ScriptPodSourceNormalizer.Normalize` (keep the
    // `TryGetValue`, remove its throw): the null manifest fails later as an ArgumentNullException, and
    // `Assert.Throws` wants the exact type. Drop the stage from that throw (no `DiagnosticStage` argument):
    // the type and message still hold, and only the stage assert catches it.
    [Test]
    public void Duplicates_limits_a_missing_manifest_and_a_missing_entrypoint_are_refused() {
        ArgumentException Reject(ScriptPodSourceBundle bundle) => Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs"))!;
        var bundle = Bundle();
        Reject(bundle with { Files = [bundle.Files[0], bundle.Files[1], bundle.Files[1] with { Path = "src/main.cs" }] });
        // Each of these two refusals is named by its own message, so an unrelated refusal cannot pass for it.
        Assert.That(Reject(bundle with { Files = [bundle.Files[0], bundle.Files[2]] }).Message, Does.Contain("lacks the selected entrypoint"));
        var noManifest = Reject(bundle with { Files = [bundle.Files[1]] });
        Assert.That(noManifest.Message, Does.Contain("Captured Pod lacks pod.json"));
        Assert.That(noManifest.ParamName, Is.EqualTo(PodManifestValidator.DiagnosticStage), "the execution service maps this to the pod-manifest stage");
        Reject(bundle with { Files = [bundle.Files[0], .. Enumerable.Range(0, 201).Select(i => new ScriptPodSourceFile($"src/F{i}.cs", ""))] });
        Reject(bundle with { Files = [bundle.Files[0], bundle.Files[1] with { BytesBase64 = Convert.ToBase64String(new byte[512 * 1024 + 1]) }] });
        Reject(bundle with { Files = [bundle.Files[0], .. Enumerable.Range(0, 9).Select(i => new ScriptPodSourceFile($"src/F{i}.cs", Convert.ToBase64String(new byte[512 * 1024])))] });
        Assert.Throws<FormatException>(() => ScriptPodSourceNormalizer.Normalize(
            bundle with { Files = [new("pod.json", "not base64!"), bundle.Files[1]] }, "sample", "src/Main.cs"));
        Assert.That(ScriptPodSourceNormalizer.Normalize(bundle, "Other Local Copy", "src/Main.cs").Manifest.Id, Is.EqualTo("sample"));
        Assert.That(ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Helper.cs").SourceSet.EntryPointSourceName, Is.EqualTo("src/Helper.cs"));
    }
}
