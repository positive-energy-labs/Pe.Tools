using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Diagnostics;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Scripting.Execution;

public sealed class ScriptCompilationService {
    internal ScriptCompilationResult Compile(
        ScriptSourceSet sourceSet,
        IReadOnlyList<MetadataReference> metadataReferences
    ) {
        var syntaxTrees = new List<SyntaxTree> {
            CSharpSyntaxTree.ParseText(
                CreateGlobalUsingsSource(),
                new CSharpParseOptions(LanguageVersion.Latest),
                path: "__PeScriptUsings.g.cs"
            )
        };

        foreach (var sourceFile in sourceSet.Files) {
            syntaxTrees.Add(CSharpSyntaxTree.ParseText(
                sourceFile.Content,
                new CSharpParseOptions(LanguageVersion.Latest),
                path: sourceFile.Name
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

    private static string CreateGlobalUsingsSource() {
        var builder = new StringBuilder();
        foreach (var @using in ScriptFileTemplates.DefaultUsings)
            builder.AppendLine($"global using {@using};");
        return builder.ToString();
    }
}
