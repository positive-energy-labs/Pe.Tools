using Pe.Shared.RevitAutomation;

namespace Pe.Dev.RevitAutomation.Worker;

internal interface IAutomationWorkloadHandler {
    AutomationJobType JobType { get; }

    void Execute(AutomationWorkloadContext context);
}