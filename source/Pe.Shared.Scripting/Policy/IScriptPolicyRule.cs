using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Execution;

namespace Pe.Shared.Scripting.Policy;

public interface IScriptPolicyRule {
    IEnumerable<ScriptDiagnostic> Analyze(
        ScriptPolicyContext context,
        ScriptSourceFile sourceFile,
        CompilationUnitSyntax root
    );
}
