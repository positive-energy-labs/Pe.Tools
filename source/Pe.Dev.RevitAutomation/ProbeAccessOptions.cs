namespace Pe.Dev.RevitAutomation;

public sealed record ProbeAccessOptions(
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? ExpectedTitle,
    string Engine,
    int TimeoutSeconds,
    bool Debug,
    bool Mask,
    bool Json
) {
    public const string DefaultEngine = "Autodesk.Revit+2025";
    public const int DefaultTimeoutSeconds = 900;
}
