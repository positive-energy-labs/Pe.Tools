using Microsoft.CodeAnalysis;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Revit.Scripting.Diagnostics;

internal static class ScriptDiagnosticFactory {
    public static ScriptDiagnostic Info(string stage, string message, string? source = null) =>
        new(stage, ScriptDiagnosticSeverity.Info, message, source);

    public static ScriptDiagnostic Warning(string stage, string message, string? source = null) =>
        new(stage, ScriptDiagnosticSeverity.Warning, message, source);

    public static ScriptDiagnostic Error(string stage, string message, string? source = null) =>
        new(stage, ScriptDiagnosticSeverity.Error, message, source);

    public static ScriptDiagnostic FromRoslynDiagnostic(Diagnostic diagnostic) {
        var severity = diagnostic.Severity switch {
            DiagnosticSeverity.Info => ScriptDiagnosticSeverity.Info,
            DiagnosticSeverity.Warning => ScriptDiagnosticSeverity.Warning,
            DiagnosticSeverity.Error => ScriptDiagnosticSeverity.Error,
            _ => ScriptDiagnosticSeverity.Info
        };

        return new ScriptDiagnostic(
            "compile",
            severity,
            diagnostic.ToString(),
            diagnostic.Location.SourceTree?.FilePath
        );
    }
}
