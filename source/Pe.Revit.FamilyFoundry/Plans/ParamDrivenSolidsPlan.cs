namespace Pe.Revit.FamilyFoundry.Plans;

/// <summary>
///     The compiled execution plan is RUNTIME-ONLY — a deterministic intermediate that is
///     inspectable in logs, proofs, and tests, and never a second authoring model. The one public
///     authoring shape is <see cref="AuthoredParamDrivenSolidsSettings" />; nothing serializes this
///     as a profile.
///     <para>
///         Validation fails BEFORE Revit mutation begins: compile-time and inference-time
///         diagnostics land here and surface in Family Foundry preview/validation flows ahead of
///         execution. Execution REFUSES unresolved or ambiguous inferred constraints — that is what
///         an Error-severity diagnostic (and therefore <c>CanExecute</c> = false) means.
///     </para>
/// </summary>
public sealed record ParamDrivenSolidsPlan(
    ParamDrivenPlanesAndDimsPlan RefPlanesAndDims,
    ParamDrivenExtrusionsPlan Extrusions,
    ParamDrivenConnectorsPlan Connectors,
    IReadOnlyList<ParamDrivenSolidsDiagnostic> Diagnostics
) {
    public bool CanExecute =>
        this.Diagnostics.All(diagnostic => diagnostic.Severity != ParamDrivenDiagnosticSeverity.Error);
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