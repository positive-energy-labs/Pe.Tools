using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.FamilyFoundry.Operations;

public sealed class EmitParamDrivenSolidsDiagnostics(EmitParamDrivenSolidsDiagnosticsSettings settings)
    : DocOperation<EmitParamDrivenSolidsDiagnosticsSettings>(settings) {
    public override string Description => "Emit authored ParamDrivenSolids compiler diagnostics";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var entries = this.Settings.Messages
            .Where(message => !string.IsNullOrWhiteSpace(message))
            .Select(message => new LogEntry("Compiler diagnostic").Success(message.Trim()))
            .ToList();

        if (entries.Count == 0)
            entries.Add(new LogEntry("Compiler diagnostic").Skip("No authored compiler diagnostics."));

        return new OperationLog(this.Name, entries);
    }
}

public sealed class EmitParamDrivenSolidsDiagnosticsSettings : IOperationSettings {
    public List<string> Messages { get; init; } = [];
    public bool Enabled { get; init; } = true;
}
