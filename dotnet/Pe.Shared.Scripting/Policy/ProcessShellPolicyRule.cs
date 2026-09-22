using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Execution;

namespace Pe.Shared.Scripting.Policy;

public sealed class ProcessShellPolicyRule : IScriptPolicyRule {
    private static readonly HashSet<string> RejectedAttributes = new(StringComparer.Ordinal) {
        "DllImport", "DllImportAttribute", "LibraryImport", "LibraryImportAttribute",
        "UnmanagedCallersOnly", "UnmanagedCallersOnlyAttribute"
    };

    public IEnumerable<ScriptDiagnostic> Analyze(
        ScriptPolicyContext context,
        ScriptSourceFile sourceFile,
        CompilationUnitSyntax root
    ) {
        if (root.DescendantNodes().OfType<InvocationExpressionSyntax>().Any(IsProcessStart)
            || root.DescendantNodes().OfType<ObjectCreationExpressionSyntax>().Any(creation =>
                GetSimpleName(creation.Type) == "Process"))
            yield return Reject("Scripts may not start external processes or shell commands.", sourceFile.Name);

        if (root.DescendantNodes().OfType<MethodDeclarationSyntax>().Any(method =>
                method.Modifiers.Any(SyntaxKind.ExternKeyword))
            || root.DescendantNodes().OfType<AttributeSyntax>().Any(attribute =>
                RejectedAttributes.Contains(GetSimpleName(attribute.Name))))
            yield return Reject("Scripts may not use unmanaged interop or P/Invoke.", sourceFile.Name);
    }

    private static bool IsProcessStart(InvocationExpressionSyntax invocation) =>
        invocation.Expression is MemberAccessExpressionSyntax member
        && member.Name.Identifier.ValueText == "Start"
        && GetSimpleName(member.Expression) == "Process";

    private static string GetSimpleName(SyntaxNode node) => node switch {
        IdentifierNameSyntax identifier => identifier.Identifier.ValueText,
        GenericNameSyntax generic => generic.Identifier.ValueText,
        QualifiedNameSyntax qualified => GetSimpleName(qualified.Right),
        AliasQualifiedNameSyntax alias => GetSimpleName(alias.Name),
        MemberAccessExpressionSyntax member => GetSimpleName(member.Name),
        _ => node.ToString().Split('.').LastOrDefault() ?? node.ToString()
    };

    private static ScriptDiagnostic Reject(string message, string source) =>
        ScriptDiagnosticFactory.Error("policy", message, source);
}
