using Pe.Revit.Global.Services.Aps.Models;

namespace Pe.Dev.RevitAutomation;

internal static class RevitAutomationShellDefinitions {
    public const string InputLocalName = "automation-input.json";
    public const string ResultLocalName = "automation-result.json";

    public static AutomationActivitySpec CreateActivitySpec(
        RevitAutomationSettings settings,
        string engine
    ) =>
        new() {
            Id = settings.ActivityId,
            Engine = engine,
            Description = "Pe.Tools Revit automation shell activity",
            AliasId = settings.AliasId,
            AppBundles = [$"{settings.Namespace}.{settings.AppBundleId}+{settings.AliasId}"],
            CommandLine = [
                $"$(engine.path)\\\\revitcoreconsole.exe /al \"$(appbundles[{settings.AppBundleId}].path)\""
            ],
            Parameters = new Dictionary<string, AutomationParameterSpec>(StringComparer.Ordinal) {
                ["inputParams"] = new() {
                    Verb = "get",
                    Description = "Automation shell input payload",
                    LocalName = InputLocalName,
                    Required = true
                },
                ["resultJson"] = new() {
                    Verb = "put",
                    Description = "Automation shell result payload",
                    LocalName = ResultLocalName,
                    Required = false
                }
            }
        };
}
