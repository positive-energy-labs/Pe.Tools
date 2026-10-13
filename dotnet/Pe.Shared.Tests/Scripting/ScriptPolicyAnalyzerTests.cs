using Microsoft.CodeAnalysis;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Policy;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ScriptPolicyAnalyzerTests {
    [TestCase("Census.cs", ScriptPermissionMode.ReadOnly, 42)]
    [TestCase("Experiment.cs", ScriptPermissionMode.NoTransaction, 43)]
    public void Read_and_explicit_writing_entrypoints_compile_and_run_independently(string entrypoint, ScriptPermissionMode mode, int expected) {
        var sources = new ScriptSourceSet([
            new("Census.cs", "public class Census { public static int Run() => Helper.Value; }"),
            new("Experiment.cs", "public class Experiment { public static int Run() { using var tx = new Transaction(); return Helper.Value + 1; } }"),
            new("Helper.cs", "public static class Helper { public const int Value = 42; }"),
            new("Transaction.cs", "public class Transaction : System.IDisposable { public void Dispose() {} }")
        ], entrypoint);
        var references = new[] { MetadataReference.CreateFromFile(typeof(object).Assembly.Location) };
        var selected = ScriptSourceClosure.Select(sources, references);
        Assert.That(ScriptPolicyAnalyzer.CreateDefault().Analyze(selected, mode, references), Is.Empty);
        var compiled = new ScriptCompilationService([]).Compile(selected, references, []);
        Assert.That(compiled.Success, Is.True, string.Join("; ", compiled.Diagnostics.Select(d => d.Message)));
        var assembly = System.Reflection.Assembly.Load(compiled.AssemblyBytes!);
        Assert.That(assembly.GetType(Path.GetFileNameWithoutExtension(entrypoint))!
            .GetMethod("Run")!.Invoke(null, null), Is.EqualTo(expected));
    }

    [Test]
    public void An_undeclared_write_is_rejected_under_the_default_request_policy() {
        var request = new ExecuteRevitScriptRequest();
        var sources = new ScriptSourceSet([new("Write.cs", "using var tx = new Transaction(doc, \"Owned\");")], "Write.cs");
        Assert.That(request.PermissionMode, Is.EqualTo(ScriptPermissionMode.ReadOnly));
        Assert.That(ScriptPolicyAnalyzer.CreateDefault().Analyze(sources, request.PermissionMode)
            .Any(d => d.Severity == ScriptDiagnosticSeverity.Error), Is.True);
    }

    [TestCase("Census.cs", ScriptPermissionMode.ReadOnly, false)]
    [TestCase("InspectRun.cs", ScriptPermissionMode.ReadOnly, false)]
    [TestCase("CoefficientExperiment.cs", ScriptPermissionMode.ReadOnly, true)]
    [TestCase("CoefficientExperiment.cs", ScriptPermissionMode.NoTransaction, false)]
    public void Snowdon_sources_are_checked_per_selected_entrypoint(string entrypoint, ScriptPermissionMode mode, bool rejected) {
        var directory = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Pe.Tools.slnx")))
            directory = directory.Parent;
        Assert.That(directory, Is.Not.Null);
        var sourceRoot = Path.Combine(directory!.FullName, "examples", "pods", "snowdon-ducts", "src");
        var sources = new ScriptSourceSet(Directory.GetFiles(sourceRoot, "*.cs")
            .Select(path => new ScriptSourceFile(Path.GetFileName(path), File.ReadAllText(path))).ToList(), entrypoint);
        var selected = ScriptSourceClosure.Select(sources);
        Assert.That(selected.Files.Select(file => file.Name), Is.EquivalentTo(new[] { entrypoint, "Probe.cs" }));
        Assert.That(ScriptPolicyAnalyzer.CreateDefault().Analyze(sources, mode)
            .Any(d => d.Severity == ScriptDiagnosticSeverity.Error), Is.EqualTo(rejected));
    }

    [Test]
    public void Entrypoint_closure_compiles_aliases_extensions_base_types_and_partial_initializers() {
        var sources = new ScriptSourceSet([
            new("Census.cs", "using Box = Helpers.Box<int>; public partial class Census : Base { public static int Run() => new Box().Read() + seed; }"),
            new("Census.Partial.cs", "public partial class Census { private static readonly int seed = Support.Value; }"),
            new("Base.cs", "public class Base {}"),
            new("Helper.cs", "namespace Helpers { public class Box<T> { public int Value => Extra.Value; } }"),
            new("Usings.cs", "global using Extras;"),
            new("Extra.cs", "namespace Extras { public static class Extra { public const int Value = 42; } }"),
            new("Extensions.cs", "public static class Extensions { public static int Read<T>(this Helpers.Box<T> value) => value.Value; }"),
            new("Support.cs", "public static class Support { public const int Value = 1; }"),
            new("Experiment.cs", "public class Experiment { public void Execute() { using var tx = new Transaction(doc, \"Owned\"); } }")
        ], "Census.cs");
        var references = new[] { MetadataReference.CreateFromFile(typeof(object).Assembly.Location) };
        var selected = ScriptSourceClosure.Select(sources, references);
        Assert.That(selected.Files.Select(file => file.Name), Is.EquivalentTo(
            new[] { "Census.cs", "Census.Partial.cs", "Base.cs", "Helper.cs", "Usings.cs", "Extra.cs", "Extensions.cs", "Support.cs" }));
        var compiled = new ScriptCompilationService([]).Compile(selected, references, []);
        Assert.That(compiled.Success, Is.True, string.Join("; ", compiled.Diagnostics.Select(d => d.Message)));
        var assembly = System.Reflection.Assembly.Load(compiled.AssemblyBytes!);
        Assert.That(assembly.GetType("Census")!.GetMethod("Run")!.Invoke(null, null), Is.EqualTo(43));
    }

    [TestCase("Transaction")]
    [TestCase("SubTransaction")]
    [TestCase("TransactionGroup")]
    public void Selecting_a_writing_entrypoint_still_requires_explicit_NoTransaction(string type) {
        var sources = new ScriptSourceSet([
            new("Census.cs", "public class Census {}"),
            new("Experiment.cs", $"public class Experiment {{ public void Execute() {{ using var tx = new {type}(doc, \"Owned\"); }} }}")
        ], "Experiment.cs");
        var analyzer = ScriptPolicyAnalyzer.CreateDefault();
        Assert.That(analyzer.Analyze(sources, ScriptPermissionMode.ReadOnly), Is.Not.Empty);
        Assert.That(analyzer.Analyze(sources, ScriptPermissionMode.WriteTransaction), Is.Not.Empty);
        Assert.That(analyzer.Analyze(sources, ScriptPermissionMode.NoTransaction), Is.Empty);
    }

    [TestCase(ScriptPermissionMode.ReadOnly)]
    [TestCase(ScriptPermissionMode.WriteTransaction)]
    public void Entrypoint_policy_does_not_reject_an_unrelated_writing_script(ScriptPermissionMode mode) {
        var sources = new ScriptSourceSet([
            new("Census.cs", "public class Census { public int Execute() => Helper.Value; }"),
            new("Helper.cs", "public static class Helper { public static int Value => 42; }"),
            new("Experiment.cs", "public class Experiment { public void Execute() { using var tx = new Transaction(doc, \"Owned\"); } }")
        ], "Census.cs");
        Assert.That(ScriptPolicyAnalyzer.CreateDefault().Analyze(sources, mode), Is.Empty);
    }

    [TestCase(ScriptPermissionMode.ReadOnly)]
    [TestCase(ScriptPermissionMode.WriteTransaction)]
    public void Entrypoint_policy_checks_transitive_helpers(ScriptPermissionMode mode) {
        var sources = new ScriptSourceSet([
            new("Census.cs", "public class Census { public void Execute() => Helper.Run(); }"),
            new("Helper.cs", "public static class Helper { public static void Run() => Writer.Run(); }"),
            new("Writer.cs", "public static class Writer { public static void Run() { using var tx = new Transaction(doc, \"Owned\"); } }")
        ], "Census.cs");
        Assert.That(ScriptPolicyAnalyzer.CreateDefault().Analyze(sources, mode)
            .Any(d => d.Source == "Writer.cs" && d.Severity == ScriptDiagnosticSeverity.Error), Is.True);
    }

    [Test]
    public void NoTransaction_allows_script_owned_transactions() {
        var diagnostics = ScriptPolicyAnalyzer.CreateDefault().Analyze(
            new ScriptSourceSet([new ScriptSourceFile("Script.cs", "using var transaction = new Transaction(doc, \"Owned\");")], "Script.cs"),
            ScriptPermissionMode.NoTransaction
        );

        Assert.That(diagnostics, Is.Empty);
    }

    [TestCase("if (DateTime.UtcNow.Ticks == long.MinValue) Process.Start(\"cmd.exe\");", "process")]
    [TestCase("Pe.Revit.Tasks.DocumentSandbox.BeginCommit(doc!, \"Blocked\");", "DocumentSandbox")]
    public void Privileged_escape_hatches_are_rejected(string source, string expectedMessage) {
        var diagnostics = ScriptPolicyAnalyzer.CreateDefault().Analyze(
            new ScriptSourceSet([new ScriptSourceFile("Script.cs", source)], "Script.cs"),
            ScriptPermissionMode.ReadOnly
        );

        Assert.That(diagnostics.Any(diagnostic =>
            diagnostic.Message.Contains(expectedMessage, StringComparison.OrdinalIgnoreCase)), Is.True);
    }
}
