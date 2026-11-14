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

    public IReadOnlyList<string> ResolveContainerTypeNames(string sourceContent) {
        var root = CSharpSyntaxTree.ParseText(sourceContent).GetCompilationUnitRoot();
        return ResolveContainerDeclarations(root).Select(GetFullTypeName).ToList();
    }

    public bool ContainsTypeDeclaration(string sourceContent) {
        var root = CSharpSyntaxTree.ParseText(sourceContent).GetCompilationUnitRoot();
        return root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>().Any();
    }

    /// <summary>True when the file is a statement body: it declares no type, so it runs only once wrapped.</summary>
    public bool IsStatementBody(string sourceContent) => !this.ContainsTypeDeclaration(sourceContent);

    /// <summary>
    ///     The one wrapping of a statement body, for an inline snippet and a Pod entrypoint alike: leading using
    ///     directives stay at file scope and the rest becomes `Execute()` of one container. A file that declares a
    ///     type is returned as written.
    /// </summary>
    public string WrapStatementBody(string sourceContent) {
        if (!this.IsStatementBody(sourceContent))
            return sourceContent;

        var root = CSharpSyntaxTree.ParseText(sourceContent).GetCompilationUnitRoot();
        var leadingUsings = root.Usings.Count == 0
            ? string.Empty
            : string.Join(Environment.NewLine, root.Usings.Select(item => item.ToFullString().TrimEnd())) +
              Environment.NewLine + Environment.NewLine;
        var bodyStart = root.Usings.Count == 0 ? 0 : root.Usings.Last().Span.End;
        var body = string.Join(Environment.NewLine, sourceContent.Substring(bodyStart).TrimStart('\r', '\n')
            .Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').Select(line => "        " + line));

        return $$"""
               {{leadingUsings}}public sealed class InlineScript : {{this._baseContainerTypeName}}
               {
                   public override void Execute()
                   {
               {{body}}
                   }
               }
               """;
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
