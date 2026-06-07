using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Shared.Scripting.Execution;

namespace Pe.Shared.Scripting.Analysis;

public sealed class ScriptEntryPointResolver(
    string baseContainerTypeName
) {
    private readonly string _baseContainerTypeName = baseContainerTypeName;

    public IReadOnlyList<string> ResolveEntryPointContainerTypeNames(ScriptSourceSet sourceSet) {
        var entryPointSource = sourceSet.Files.FirstOrDefault(file =>
            string.Equals(file.Name, sourceSet.EntryPointSourceName, StringComparison.OrdinalIgnoreCase));
        if (entryPointSource == null)
            return [];

        var root = CSharpSyntaxTree.ParseText(entryPointSource.Content).GetCompilationUnitRoot();
        return ResolveContainerDeclarations(root)
            .Select(GetFullTypeName)
            .ToList();
    }

    public bool ContainsContainerDeclaration(string sourceContent) {
        var root = CSharpSyntaxTree.ParseText(sourceContent).GetCompilationUnitRoot();
        return ResolveContainerDeclarations(root).Any();
    }

    public bool ContainsTypeDeclaration(string sourceContent) {
        var root = CSharpSyntaxTree.ParseText(sourceContent).GetCompilationUnitRoot();
        return root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>().Any();
    }

    private IEnumerable<ClassDeclarationSyntax> ResolveContainerDeclarations(CompilationUnitSyntax root) => root.DescendantNodes()
        .OfType<ClassDeclarationSyntax>()
        .Where(IsContainerDeclaration);

    private bool IsContainerDeclaration(ClassDeclarationSyntax declaration) =>
        declaration.Modifiers.Any(SyntaxKind.AbstractKeyword) == false &&
        declaration.BaseList?.Types.Any(type =>
            type.Type.ToString().Equals(this._baseContainerTypeName, StringComparison.Ordinal) ||
            type.Type.ToString().EndsWith($".{this._baseContainerTypeName}", StringComparison.Ordinal)) == true;

    private static string GetFullTypeName(ClassDeclarationSyntax declaration) {
        var names = new Stack<string>();
        names.Push(declaration.Identifier.ValueText);

        for (SyntaxNode? node = declaration.Parent; node != null; node = node.Parent) {
            switch (node) {
            case BaseNamespaceDeclarationSyntax namespaceDeclaration:
                names.Push(namespaceDeclaration.Name.ToString());
                break;
            case ClassDeclarationSyntax containingClass:
                names.Push(containingClass.Identifier.ValueText);
                break;
            }
        }

        return string.Join(".", names);
    }
}
