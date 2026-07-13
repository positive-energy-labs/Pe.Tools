using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Execution;

namespace Pe.Shared.Scripting.Policy;

public sealed class RevitTransactionPolicyRule : IScriptPolicyRule {
    private static readonly HashSet<string> RejectedTransactionTypes = new(StringComparer.Ordinal) {
        "Transaction",
        "SubTransaction",
        "TransactionGroup"
    };

    public IEnumerable<ScriptDiagnostic> Analyze(
        ScriptPolicyContext context,
        ScriptSourceFile sourceFile,
        CompilationUnitSyntax root
    ) {
        foreach (var creation in root.DescendantNodes().OfType<ObjectCreationExpressionSyntax>()) {
            var typeName = GetSimpleName(creation.Type);
            if (!RejectedTransactionTypes.Contains(typeName))
                continue;

            var message = context.PermissionMode == ScriptPermissionMode.WriteTransaction
                ? "WriteTransaction scripts may not create their own Revit transactions; the host owns the transaction."
                : "ReadOnly scripts may not create Revit Transaction, SubTransaction, or TransactionGroup instances.";
            yield return ScriptDiagnosticFactory.Error("policy", message, sourceFile.Name);
        }

        foreach (var invocation in root.DescendantNodes().OfType<InvocationExpressionSyntax>()) {
            if (invocation.Expression is not MemberAccessExpressionSyntax {
                    Name.Identifier.ValueText: "BeginCommit"
                } member
                || GetSimpleName(member.Expression) != "DocumentSandbox")
                continue;

            yield return ScriptDiagnosticFactory.Error(
                "policy",
                "Scripts may not open a commit-mode DocumentSandbox; the scripting host owns transaction boundaries.",
                sourceFile.Name
            );
        }
    }

    private static string GetSimpleName(TypeSyntax type) =>
        type switch {
            IdentifierNameSyntax identifier => identifier.Identifier.ValueText,
            QualifiedNameSyntax qualifiedName => GetSimpleName(qualifiedName.Right),
            AliasQualifiedNameSyntax aliasQualifiedName => GetSimpleName(aliasQualifiedName.Name),
            GenericNameSyntax genericName => genericName.Identifier.ValueText,
            _ => type.ToString().Split('.').LastOrDefault() ?? type.ToString()
        };

    private static string GetSimpleName(ExpressionSyntax expression) => expression switch {
        IdentifierNameSyntax identifier => identifier.Identifier.ValueText,
        MemberAccessExpressionSyntax member => member.Name.Identifier.ValueText,
        _ => expression.ToString().Split('.').LastOrDefault() ?? expression.ToString()
    };
}
