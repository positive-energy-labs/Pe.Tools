using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Pe.Shared.Scripting.Execution;

public static class ScriptSourceClosure {
    public static ScriptSourceSet Select(
        ScriptSourceSet sourceSet,
        IReadOnlyList<MetadataReference>? references = null,
        IReadOnlyList<string>? usings = null
    ) {
        var trees = sourceSet.Files.Select(file => CSharpSyntaxTree.ParseText(
            file.Content, new CSharpParseOptions(LanguageVersion.Latest), file.Name)).ToList();
        var entry = trees.SingleOrDefault(tree => string.Equals(
            tree.FilePath, sourceSet.EntryPointSourceName, StringComparison.OrdinalIgnoreCase));
        if (entry is null)
            throw new ArgumentException("The entrypoint is not in the captured source set.", nameof(sourceSet));

        var compilation = CSharpCompilation.Create("PeScriptPolicy", trees.Append(
            CSharpSyntaxTree.ParseText(ScriptCompilationService.CreateGlobalUsingsSource(usings ?? [], []))),
            references ?? [], new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
        var selected = new HashSet<SyntaxTree>();
        var pending = new Queue<SyntaxTree>();
        Include(entry);
        foreach (var tree in trees.Where(tree => tree.GetCompilationUnitRoot().Usings
                     .Any(directive => directive.GlobalKeyword.IsKind(SyntaxKind.GlobalKeyword))))
            Include(tree);
        while (pending.Count > 0) {
            var tree = pending.Dequeue();
            var model = compilation.GetSemanticModel(tree);
            foreach (var node in tree.GetRoot().DescendantNodes()) {
                // Partial types and inherited members belong to the same executable dependency.
                if (node is BaseTypeDeclarationSyntax declaration)
                    IncludeSymbol(model.GetDeclaredSymbol(declaration));
                if (node is not ExpressionSyntax && node is not AttributeSyntax)
                    continue;
                var info = model.GetSymbolInfo(node);
                IncludeSymbol(info.Symbol);
                foreach (var candidate in info.CandidateSymbols)
                    IncludeSymbol(candidate);
            }
        }

        return sourceSet with {
            Files = sourceSet.Files.Where((_, index) => selected.Contains(trees[index])).ToList()
        };

        void Include(SyntaxTree tree) {
            if (trees.Contains(tree) && selected.Add(tree))
                pending.Enqueue(tree);
        }

        void IncludeSymbol(ISymbol? symbol) {
            if (symbol is IAliasSymbol alias)
                symbol = alias.Target;
            if (symbol is null)
                return;
            foreach (var declaration in symbol.OriginalDefinition.DeclaringSyntaxReferences)
                Include(declaration.SyntaxTree);
            if (symbol.ContainingType is { } type)
                foreach (var declaration in type.OriginalDefinition.DeclaringSyntaxReferences)
                    Include(declaration.SyntaxTree);
        }
    }
}
