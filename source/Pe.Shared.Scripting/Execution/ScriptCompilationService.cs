using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Pe.Shared.Scripting.Diagnostics;
using System.Text;

namespace Pe.Shared.Scripting.Execution;

public sealed class ScriptCompilationService(
    IReadOnlyList<string> defaultUsings
) {
    private readonly IReadOnlyList<string> _defaultUsings = defaultUsings;

    public ScriptCompilationResult Compile(
        ScriptSourceSet sourceSet,
        IReadOnlyList<MetadataReference> metadataReferences,
        IReadOnlyList<string> projectUsings
    ) {
        var syntaxTrees = new List<SyntaxTree> {
            CSharpSyntaxTree.ParseText(
                CreateGlobalUsingsSource(this._defaultUsings, projectUsings),
                new CSharpParseOptions(LanguageVersion.Latest),
                "__PeScriptUsings.g.cs"
            )
        };

        foreach (var sourceFile in sourceSet.Files) {
            syntaxTrees.Add(CSharpSyntaxTree.ParseText(
                sourceFile.Content,
                new CSharpParseOptions(LanguageVersion.Latest),
                sourceFile.Name
            ));
        }

        var compilation = CSharpCompilation.Create(
            $"PeScript_{Guid.NewGuid():N}",
            syntaxTrees,
            metadataReferences,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary)
        );

        using var assemblyStream = new MemoryStream();
        var emitResult = compilation.Emit(assemblyStream);
        if (!emitResult.Success) {
            return new ScriptCompilationResult(
                false,
                null,
                emitResult.Diagnostics
                    .Where(diagnostic => diagnostic.Severity is DiagnosticSeverity.Warning or DiagnosticSeverity.Error)
                    .Select(ScriptDiagnosticFactory.FromRoslynDiagnostic)
                    .ToList()
            );
        }

        return new ScriptCompilationResult(
            true,
            assemblyStream.ToArray(),
            emitResult.Diagnostics
                .Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Warning)
                .Select(ScriptDiagnosticFactory.FromRoslynDiagnostic)
                .ToList()
        );
    }

    public static string CreateGlobalUsingsSource(
        IReadOnlyList<string> defaultUsings,
        IReadOnlyList<string> projectUsings
    ) {
        var builder = new StringBuilder();
        foreach (var @using in defaultUsings
                     .Concat(projectUsings)
                     .Distinct(StringComparer.Ordinal))
            _ = builder.AppendLine($"global using {@using};");
        return builder.ToString();
    }
}
