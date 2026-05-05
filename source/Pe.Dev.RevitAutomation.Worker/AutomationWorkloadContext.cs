using Pe.Shared.RevitAutomation;
using Autodesk.Revit.DB;

namespace Pe.Dev.RevitAutomation.Worker;

internal sealed record AutomationWorkloadContext(
    AutomationJobInput Input,
    Document Document,
    string ResultPath,
    Action<string, object?> WriteJobMarker
);