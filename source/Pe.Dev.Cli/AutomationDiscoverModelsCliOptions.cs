using Pe.Dev.RevitAutomation;
using Pe.Shared.RevitData;
using System.Globalization;

namespace Pe.Dev.Cli;

internal sealed record AutomationDiscoverModelsCliOptions(
    string HubId,
    string ProjectId,
    string? FolderId,
    string? FolderPath,
    string? NameContains,
    bool Recurse,
    IReadOnlyList<string> ExcludePathGlobs,
    string? OutManifestPath,
    string? Region,
    string Engine,
    int TimeoutSeconds,
    int MaxConcurrency,
    bool Debug,
    bool Mask,
    bool Json,
    LoadedFamiliesFilter? Filter
) {
    public const string UsageText = """
                                    Usage:
                                      pe-dev revit automation discover-models --hub-id <id> --project-id <id> [--folder-id <id> | --folder-path <path>] [--name-contains <text>] [--recurse <true|false>] [--exclude-path-glob <pattern>]... [--region <US|EMEA>] [--out-manifest <path>] [--engine <engine>] [--timeout-seconds <seconds>] [--max-concurrency <count>] [--debug <true|false>] [--mask <true|false>] [--family-name <name>]... [--category-name <name>]... [--placement-scope <AllLoaded|PlacedOnly|UnplacedOnly>] [--json]
                                    """;

    public static AutomationDiscoverModelsCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "discover-models", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `discover-models` after `pe-dev revit automation`.");

        string? hubId = null;
        string? projectId = null;
        string? folderId = null;
        string? folderPath = null;
        string? nameContains = null;
        var excludePathGlobs = new List<string>();
        string? outManifestPath = null;
        string? region = null;
        var recurse = true;
        var engine = ParameterCollectionOptions.DefaultEngine;
        var timeoutSeconds = ParameterCollectionOptions.DefaultTimeoutSeconds;
        var maxConcurrency = 4;
        var debug = true;
        var mask = true;
        var json = false;
        var familyNames = new List<string>();
        var categoryNames = new List<string>();
        LoadedFamilyPlacementScope? placementScope = null;

        for (var i = 1; i < args.Count; i++) {
            switch (args[i]) {
            case "--hub-id":
                hubId = RequireValue(args, ref i, args[i]);
                break;
            case "--project-id":
                projectId = RequireValue(args, ref i, args[i]);
                break;
            case "--folder-id":
                folderId = RequireValue(args, ref i, args[i]);
                break;
            case "--folder-path":
                folderPath = RequireValue(args, ref i, args[i]);
                break;
            case "--name-contains":
                nameContains = RequireValue(args, ref i, args[i]);
                break;
            case "--exclude-path-glob":
                excludePathGlobs.Add(RequireValue(args, ref i, args[i]));
                break;
            case "--recurse":
                recurse = ReadBooleanOption(args, ref i, true);
                break;
            case "--out-manifest":
                outManifestPath = RequireValue(args, ref i, args[i]);
                break;
            case "--region":
                region = RequireValue(args, ref i, args[i]);
                break;
            case "--engine":
                engine = RequireValue(args, ref i, args[i]);
                break;
            case "--timeout-seconds":
                timeoutSeconds = int.Parse(RequireValue(args, ref i, args[i]), CultureInfo.InvariantCulture);
                break;
            case "--max-concurrency":
                maxConcurrency = int.Parse(RequireValue(args, ref i, args[i]), CultureInfo.InvariantCulture);
                break;
            case "--debug":
                debug = ReadBooleanOption(args, ref i, true);
                break;
            case "--mask":
                mask = ReadBooleanOption(args, ref i, true);
                break;
            case "--family-name":
                familyNames.Add(RequireValue(args, ref i, args[i]));
                break;
            case "--category-name":
                categoryNames.Add(RequireValue(args, ref i, args[i]));
                break;
            case "--placement-scope":
                placementScope = Enum.Parse<LoadedFamilyPlacementScope>(RequireValue(args, ref i, args[i]), true);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation discovery argument '{args[i]}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(hubId))
            throw new ArgumentException("Missing required argument `--hub-id`.");
        if (string.IsNullOrWhiteSpace(projectId))
            throw new ArgumentException("Missing required argument `--project-id`.");
        if (!string.IsNullOrWhiteSpace(folderId) && !string.IsNullOrWhiteSpace(folderPath))
            throw new ArgumentException("Pass either `--folder-id` or `--folder-path`, not both.");

        return new AutomationDiscoverModelsCliOptions(
            hubId,
            projectId,
            folderId,
            folderPath,
            nameContains,
            recurse,
            excludePathGlobs,
            outManifestPath,
            region,
            engine,
            timeoutSeconds,
            maxConcurrency,
            debug,
            mask,
            json,
            BuildFilter(familyNames, categoryNames, placementScope)
        );
    }

    public ModelDiscoveryOptions ToOptions() => new(
        this.HubId,
        this.ProjectId,
        this.FolderId,
        this.FolderPath,
        this.NameContains,
        this.Recurse,
        this.ExcludePathGlobs,
        this.OutManifestPath,
        this.Region,
        this.Engine,
        this.TimeoutSeconds,
        this.MaxConcurrency,
        this.Debug,
        this.Mask,
        this.Filter
    );

    private static LoadedFamiliesFilter? BuildFilter(
        IReadOnlyList<string> familyNames,
        IReadOnlyList<string> categoryNames,
        LoadedFamilyPlacementScope? placementScope
    ) =>
        familyNames.Count == 0 && categoryNames.Count == 0 && placementScope == null
            ? null
            : new LoadedFamiliesFilter {
                FamilyNames = familyNames.Count == 0 ? [] : familyNames.ToList(),
                CategoryNames = categoryNames.Count == 0 ? [] : categoryNames.ToList(),
                PlacementScope = placementScope ?? LoadedFamilyPlacementScope.AllLoaded
            };

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }

    private static bool ReadBooleanOption(IReadOnlyList<string> args, ref int index, bool defaultValue) {
        if (index + 1 >= args.Count || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            return defaultValue;

        index++;
        return bool.Parse(args[index]);
    }
}