using Pe.Revit.Global.Services.Aps.Models;

namespace Pe.Dev.RevitAutomation.Worker;

internal interface IAutomationWorkloadHandler {
    AutomationJobType JobType { get; }

    void Execute(AutomationWorkloadContext context);
}
