namespace Pe.Dev.RevitAutomation;

public sealed record AutomationWorkItemInspectOptions(
    string WorkItemId,
    bool IncludeReport,
    bool Mask,
    bool Json
);
