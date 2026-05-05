using Pe.Aps.DesignAutomation;
using Pe.Shared.RevitVersions;

namespace Pe.Dev.RevitAutomation;

internal static class RevitAutomationShellDefinitions {
    public const string InputLocalName = "automation-input.json";
    public const string InputModelLocalName = "input-model.rvt";
    public const string ResultLocalName = "automation-result.json";

    public static ResolvedAutomationShellIds ForYear(RevitAutomationSettings settings, int year) {
        var spec = RevitVersionCatalog.RequireByYear(year);
        return new ResolvedAutomationShellIds(
            settings.Namespace,
            $"{settings.AppBundleId}_{spec.ConfigurationSuffix}",
            $"{settings.ActivityId}_{spec.ConfigurationSuffix}",
            settings.AliasId
        );
    }

    public static AutomationActivitySpec CreateActivitySpec(
        ResolvedAutomationShellIds shellIds,
        string engine
    ) =>
        new() {
            Id = shellIds.ActivityId,
            Engine = engine,
            Description = "Pe.Tools Revit automation shell activity",
            AliasId = shellIds.AliasId,
            AppBundles = [shellIds.QualifiedAppBundleAlias],
            CommandLine = [
                $"$(engine.path)\\\\revitcoreconsole.exe /al \"$(appbundles[{shellIds.AppBundleId}].path)\""
            ],
            Parameters = new Dictionary<string, AutomationParameterSpec>(StringComparer.Ordinal) {
                ["inputParams"] =
                    new() {
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
                },
                ["inputModel"] = new() {
                    Verb = "get",
                    Description = "Optional transient local source model input",
                    LocalName = InputModelLocalName,
                    Required = false
                }
            }
        };
}

internal sealed record ResolvedAutomationShellIds(
    string Namespace,
    string AppBundleId,
    string ActivityId,
    string AliasId
) {
    public string QualifiedAppBundleAlias => $"{this.Namespace}.{this.AppBundleId}+{this.AliasId}";
    public string QualifiedActivityAlias => $"{this.Namespace}.{this.ActivityId}+{this.AliasId}";
}
