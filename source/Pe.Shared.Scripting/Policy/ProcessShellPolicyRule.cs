using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Execution;

namespace Pe.Shared.Scripting.Policy;

public sealed class ProcessShellPolicyRule : IScriptPolicyRule {
    private static readonly HashSet<string> RejectedAttributeNames = new(StringComparer.Ordinal) {
        "DllImport",
        "DllImportAttribute",
        "LibraryImport",
        "LibraryImportAttribute",
        "UnmanagedCallersOnly",
        "UnmanagedCallersOnlyAttribute"
    };

    public IEnumerable<ScriptDiagnostic> Analyze(
        ScriptPolicyContext context,
        ScriptSourceFile sourceFile,
        CompilationUnitSyntax root
    ) {
        foreach (var invocation in root.DescendantNodes().OfType<InvocationExpressionSyntax>()) {
            if (IsProcessStartInvocation(invocation)) {
                yield return ScriptDiagnosticFactory.Error(
                    "policy",
                    "Scripts may not start external processes or shell commands.",
                    sourceFile.Name
                );
            }
        }

        foreach (var creation in root.DescendantNodes().OfType<ObjectCreationExpressionSyntax>()) {
            if (IsNamedType(creation.Type, "Process")) {
                yield return ScriptDiagnosticFactory.Error(
                    "policy",
                    "Scripts may not create System.Diagnostics.Process instances.",
                    sourceFile.Name
                );
            }
        }

        foreach (var declaration in root.DescendantNodes().OfType<MethodDeclarationSyntax>()) {
            if (declaration.Modifiers.Any(SyntaxKind.ExternKeyword)) {
                yield return ScriptDiagnosticFactory.Error(
                    "policy",
                    "Scripts may not declare extern methods or P/Invoke entry points.",
                    sourceFile.Name
                );
            }
        }

        foreach (var attribute in root.DescendantNodes().OfType<AttributeSyntax>()) {
            if (RejectedAttributeNames.Contains(GetSimpleName(attribute.Name))) {
                yield return ScriptDiagnosticFactory.Error(
                    "policy",
                    "Scripts may not use unmanaged interop attributes such as DllImport or LibraryImport.",
                    sourceFile.Name
                );
            }
        }
    }

    private static bool IsProcessStartInvocation(InvocationExpressionSyntax invocation) =>
        invocation.Expression switch {
            MemberAccessExpressionSyntax memberAccess =>
                memberAccess.Name.Identifier.ValueText == "Start" &&
                IsNamedExpression(memberAccess.Expression, "Process"),
            _ => false
        };

    private static bool IsNamedType(TypeSyntax type, string name) =>
        GetSimpleName(type).Equals(name, StringComparison.Ordinal);

    private static bool IsNamedExpression(ExpressionSyntax expression, string name) =>
        GetSimpleName(expression).Equals(name, StringComparison.Ordinal);

    private static string GetSimpleName(SyntaxNode node) =>
        node switch {
            IdentifierNameSyntax identifier => identifier.Identifier.ValueText,
            GenericNameSyntax genericName => genericName.Identifier.ValueText,
            QualifiedNameSyntax qualifiedName => GetSimpleName(qualifiedName.Right),
            AliasQualifiedNameSyntax aliasQualifiedName => GetSimpleName(aliasQualifiedName.Name),
            MemberAccessExpressionSyntax memberAccess => GetSimpleName(memberAccess.Name),
            _ => node.ToString().Split('.').LastOrDefault() ?? node.ToString()
        };
}
