using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Scripting.References;

internal sealed record ScriptReferenceDeclaration(
    string Include,
    string HintPath
);

internal sealed record ScriptPackageReference(
    string Include,
    string? Version
);

internal sealed record ScriptProjectFileModel(
    string ProjectContent,
    string? ProjectDirectory,
    string TargetFramework,
    IReadOnlyList<ScriptReferenceDeclaration> References,
    IReadOnlyList<ScriptPackageReference> PackageReferences
);

public sealed record ResolvedScriptProject(
    string ProjectContent,
    string TargetFramework,
    IReadOnlyList<string> CompileReferencePaths,
    IReadOnlyList<string> RuntimeReferencePaths,
    IReadOnlyList<ScriptDiagnostic> Diagnostics
) {
    public bool HasErrors =>
        this.Diagnostics.Any(diagnostic => diagnostic.Severity == ScriptDiagnosticSeverity.Error);
}
