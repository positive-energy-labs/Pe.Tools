using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Resolution;

public sealed record ParamDrivenSolidsCompileResult(
    MakeParamDrivenPlanesAndDimsSettings RefPlanesAndDims,
    MakeConstrainedExtrusionsSettings InternalExtrusions,
    MakeParamDrivenConnectorsSettings Connectors,
    IReadOnlyList<ParamDrivenSolidsDiagnostic> Diagnostics
) {
    public bool CanExecute => this.Diagnostics.All(diagnostic => diagnostic.Severity != ParamDrivenDiagnosticSeverity.Error);
}

public sealed record ParamDrivenSolidsDiagnostic(
    ParamDrivenDiagnosticSeverity Severity,
    string SolidName,
    string Path,
    string Message
) {
    public string ToDisplayMessage() {
        var prefix = this.Severity == ParamDrivenDiagnosticSeverity.Error ? "Error" : "Warning";
        var solidSegment = string.IsNullOrWhiteSpace(this.SolidName) ? string.Empty : $" [{this.SolidName}]";
        return $"{prefix}{solidSegment} {this.Path}: {this.Message}";
    }
}

public enum ParamDrivenDiagnosticSeverity {
    Warning,
    Error
}

public static class ParamDrivenSolidsDiagnosticFormatter {
    public static IReadOnlyList<string> ToDisplayMessages(IReadOnlyList<ParamDrivenSolidsDiagnostic> diagnostics) =>
        diagnostics.Select(diagnostic => diagnostic.ToDisplayMessage()).ToList();
}
