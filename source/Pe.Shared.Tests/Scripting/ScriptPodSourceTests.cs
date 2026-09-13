using Microsoft.CodeAnalysis;
using Newtonsoft.Json;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.References;
using System.Reflection;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ScriptPodSourceTests {
    private static string Encode(string content) => Convert.ToBase64String(Encoding.UTF8.GetBytes(content));
    private static ScriptPodSourceBundle Bundle() => new(
        Encode("""{"schemaVersion":1,"id":"sample","name":"Sample","version":"1.0.0","entrypoints":[{"id":"main","sourcePath":"src/Main.cs"}]}"""),
        new ScriptPodProjectSeed(false, null),
        [new("src/Main.cs", Encode("public static class Main { public static int Run() => Helper.Value; }")),
         new("src/Helper.cs", Encode("public static class Helper { public const int Value = 42; }"))]);

    private static void CompileAndRun(ScriptPodSourceBundle bundle) {
        var normalized = ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs");
        var compiled = new ScriptCompilationService([]).Compile(normalized.SourceSet,
            [MetadataReference.CreateFromFile(typeof(object).Assembly.Location)], []);
        Assert.That(compiled.Success, Is.True, string.Join("; ", compiled.Diagnostics.Select(d => d.Message)));
        var assembly = Assembly.Load(compiled.AssemblyBytes!);
        Assert.That(assembly.GetType("Main")!.GetMethod("Run")!.Invoke(null, null), Is.EqualTo(42));
        Assert.That(normalized.SourceSet.EntryPointSourceName, Is.EqualTo("Main.cs"));
        Assert.That(normalized.SourceSet.Files.All(f => f.FullPath is null), Is.True);
    }

    [Test]
    public void Captured_set_compiles_without_a_workspace_or_materialization() => CompileAndRun(Bundle());

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
            var bundle = Bundle() with { Project = new(true, Encode(seed)), Sources = [Bundle().Sources[0]] };
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
        bundle.Sources[1] = new("src/Helper.cs", Convert.ToBase64String(Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(source)).ToArray()));
        CompileAndRun(bundle);
        Assert.That(ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs").ProjectSeed, Is.Null);
        var project = "<Project><ItemGroup><Reference Include=\"Local\"><HintPath>lib\\$(RevitYear)\\Local.dll</HintPath></Reference></ItemGroup></Project>";
        var captured = bundle with { Project = new ScriptPodProjectSeed(true, Encode(project)) };
        Assert.That(ScriptPodSourceNormalizer.Normalize(captured, "sample", "src/Main.cs").ProjectSeed, Is.EqualTo(project));
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle with { Project = new(true, null) }, "sample", "src/Main.cs"));
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle with { Project = new(false, Encode(project)) }, "sample", "src/Main.cs"));
        Assert.Throws<JsonSerializationException>(() => JsonConvert.DeserializeObject<ScriptPodProjectSeed>("{}"));
    }

    [TestCase("../Main.cs")]
    [TestCase("src/../Main.cs")]
    [TestCase("C:/Main.cs")]
    [TestCase("src/Main.txt")]
    [TestCase("src//Main.cs")]
    public void Invalid_paths_are_refused(string path) {
        var bundle = Bundle();
        bundle.Sources[0] = bundle.Sources[0] with { Path = path };
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs"));
    }

    [Test]
    public void Duplicates_limits_missing_entrypoint_and_wrong_workspace_are_refused() {
        void Reject(ScriptPodSourceBundle bundle) => Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Main.cs"));
        var bundle = Bundle();
        Reject(bundle with { Sources = [bundle.Sources[0], bundle.Sources[0] with { Path = "src/main.cs" }] });
        Reject(bundle with { Sources = [bundle.Sources[1]] });
        Reject(bundle with { Sources = Enumerable.Range(0, 201).Select(i => new ScriptPodSourceFile($"src/F{i}.cs", "")).ToList() });
        Reject(bundle with { Sources = [bundle.Sources[0] with { BytesBase64 = Convert.ToBase64String(new byte[512 * 1024 + 1]) }] });
        Reject(bundle with { Sources = Enumerable.Range(0, 5).Select(i => new ScriptPodSourceFile($"src/F{i}.cs", Convert.ToBase64String(new byte[512 * 1024]))).ToList() });
        Reject(bundle with { ManifestBase64 = "not base64!" });
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle, "other", "src/Main.cs"));
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.Normalize(bundle, "sample", "src/Helper.cs"));
    }
}
