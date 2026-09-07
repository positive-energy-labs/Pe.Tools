using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Policy;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ScriptPolicyAnalyzerTests {
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
