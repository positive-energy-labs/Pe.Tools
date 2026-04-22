using Autodesk.Revit.DB;
using Pe.Shared.Aps.Models;

namespace Pe.Dev.RevitAutomation.Worker;

internal sealed record AutomationWorkloadContext(
    AutomationJobInput Input,
    Document Document,
    string ResultPath,
    Action<string, object?> WriteJobMarker
);