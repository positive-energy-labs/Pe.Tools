using Microsoft.CodeAnalysis.CSharp;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;

namespace Pe.Shared.Scripting.Policy;

public sealed class ScriptPolicyAnalyzer(
    IReadOnlyList<IScriptPolicyRule> rules
) {
    private readonly IReadOnlyList<IScriptPolicyRule> _rules = rules;

    public static ScriptPolicyAnalyzer CreateDefault() => new([
        new ProcessShellPolicyRule(),
        new RevitTransactionPolicyRule()
    ]);

    public IReadOnlyList<ScriptDiagnostic> Analyze(
        ScriptSourceSet sourceSet,
        ScriptPermissionMode permissionMode
    ) {
        var context = new ScriptPolicyContext(permissionMode);
        var diagnostics = new List<ScriptDiagnostic>();
        foreach (var sourceFile in sourceSet.Files) {
            var root = CSharpSyntaxTree.ParseText(sourceFile.Content, path: sourceFile.Name)
                .GetCompilationUnitRoot();
            foreach (var rule in this._rules)
                diagnostics.AddRange(rule.Analyze(context, sourceFile, root));
        }

        return diagnostics;
    }
}
