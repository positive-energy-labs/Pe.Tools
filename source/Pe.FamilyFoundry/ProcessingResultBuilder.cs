using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.FamilyFoundry;

/// <summary>
///     Fluent builder for generating processing result output files.
/// </summary>
public class ProcessingResultBuilder(Storage storage) {
    private readonly List<FamilyProcessingContext> _familyContexts = [];
    private readonly OutputManager _runOutput = storage.OutputDir().TimestampedSubDir();
    private List<(string Name, string Description, string Type, string IsMerged)> _operationMetadata = [];
    private string _profileName;
    private object _profileSettings;

    private static string GetDescription(ParamSnapshot param) =>
        $"{GetInstTypeStr(param)}: {param.Name} ({GetDataTypeLabel(param)})";

    private static string GetDataTypeLabel(ParamSnapshot param) => SpecNamesProvider.GetLabelForForge(param.DataType);

    private static string GetPropGroupLabel(ParamSnapshot param) =>
        PropertyGroupNamesProvider.GetLabelForForge(param.PropertiesGroup);

    private static string GetInstTypeStr(ParamSnapshot param) => param.IsInstance ? "INST" : "TYPE";

    public ProcessingResultBuilder WithProfile<T>(T settings, string profileName) where T : BaseProfileSettings {
        this._profileSettings = settings;
        this._profileName = profileName;
        return this;
    }

    public ProcessingResultBuilder WithOperationMetadata(OperationQueue queue) {
        this._operationMetadata = queue.GetExecutableMetadata();
        return this;
    }

    /// <summary>
    ///     Writes output for a single family context as it completes.
    ///     Outputs to a subdirectory named after the family within the run directory.
    /// </summary>
    public void WriteSingleFamilyOutput(FamilyProcessingContext ctx, bool openOnFinish = false) {
        if (this._runOutput == null)
            throw new InvalidOperationException("Must call InitializeRun() before WriteSingleFamilyOutput()");

        // Track contexts for summary
        this._familyContexts.Add(ctx);

        var familyDirName = SanitizeDirName(ctx.FamilyName);
        var familyOutput = this._runOutput.SubDir(familyDirName);

        // Serialize each section separately (pre-processing)
        if (ctx.PreProcessSnapshot != null)
            SerializeSnapshotSections(ctx.PreProcessSnapshot, familyOutput, "pre");

        // Serialize each section separately (post-processing)
        if (ctx.PostProcessSnapshot != null)
            SerializeSnapshotSections(ctx.PostProcessSnapshot, familyOutput, "post");

        var settingsName = $"snapshot-profile-{this._profileName}.json";
        var abridgedName = "logs-abridged.json";
        var detailedName = "logs-detailed.json";
        var paramDiffName = "snapshot-parameters-diff.json";

        _ = familyOutput.Json(settingsName).Write(this._profileSettings);
        _ = familyOutput.Json(abridgedName).Write(BuildAbridged(ctx));
        var detailedPath = familyOutput.Json(detailedName).Write(this.BuildDetailed(ctx))!;
        _ = familyOutput.Json(paramDiffName).Write(BuildParameterDiff(ctx));

        if (openOnFinish) FileUtils.OpenInDefaultApp(detailedPath);
    }

    /// <summary>
    ///     Writes a summary file aggregating results from all families processed incrementally.
    ///     Should be called after all families have been processed.
    /// </summary>
    public void WriteMultiFamilySummary(double totalMs, bool openOnFinish = false) {
        if (this._runOutput == null)
            throw new InvalidOperationException("Must call InitializeRun() before WriteMultiFamilySummary()");

        if (!this._familyContexts.Any()) return;

        var totalErrors = this._familyContexts
            .SelectMany(ctx => {
                var (logs, err) = ctx.OperationLogs;
                if (err != null) return [];
                return logs?.SelectMany(log => log.Entries.Where(e => e.Status == LogStatus.Error))
                       ?? [];
            })
            .Count();

        var familySummaries = this._familyContexts.Select(ctx => {
            var (logs, err) = ctx.OperationLogs;
            var errorCount = err != null
                ? 1
                : logs?.SelectMany(log => log.Entries.Where(e => e.Status == LogStatus.Error)).Count() ?? 0;

            return new {
                Family = ctx.FamilyName,
                Status = err != null ? "Failed" : errorCount > 0 ? "Completed with errors" : "Success",
                SecondsElapsed = Math.Round(ctx.TotalMs / 1000.0, 3),
                ErrorCount = errorCount
            };
        }).ToList();

        var summary = new {
            Profile = this._profileName,
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            TotalSecondsElapsed = Math.Round(totalMs / 1000.0, 3),
            Summary = new {
                TotalFamilies = this._familyContexts.Count,
                Successful = familySummaries.Count(f => f.Status == "Success"),
                CompletedWithErrors = familySummaries.Count(f => f.Status == "Completed with errors"),
                Failed = familySummaries.Count(f => f.Status == "Failed"),
                TotalErrors = totalErrors
            },
            Families = familySummaries
        };

        var summaryPath = this._runOutput.Json("run-summary.json").Write(summary);

        if (openOnFinish) FileUtils.OpenInDefaultApp(summaryPath);
    }

    private static object BuildAbridged(FamilyProcessingContext ctx) {
        var (logs, err) = ctx.OperationLogs;
        if (err is not null) {
            return new {
                Family = ctx.FamilyName,
                TotalSecondsElapsed = Math.Round(ctx.TotalMs / 1000.0, 3),
                PreCollectionSecondsElapsed = Math.Round(ctx.PreCollectionMs / 1000.0, 3),
                OperationsSecondsElapsed = Math.Round(ctx.OperationsMs / 1000.0, 3),
                PostCollectionSecondsElapsed = Math.Round(ctx.PostCollectionMs / 1000.0, 3),
                Error = err.Message
            };
        }

        var operationLogs = logs ?? [];
        return new {
            Family = ctx.FamilyName,
            TotalSecondsElapsed = Math.Round(ctx.TotalMs / 1000.0, 3),
            PreCollectionSecondsElapsed = Math.Round(ctx.PreCollectionMs / 1000.0, 3),
            OperationsSecondsElapsed = Math.Round(ctx.OperationsMs / 1000.0, 3),
            PostCollectionSecondsElapsed = Math.Round(ctx.PostCollectionMs / 1000.0, 3),
            Operations = operationLogs.Select(log => new {
                log.OperationName,
                SuccessTotal = $"{log.SuccessCount}/{log.SuccessCount + log.ErrorCount}",
                Errors = BuildMessages(log.Entries, LogStatus.Error)
            }).ToList()
        };
    }

    private object BuildDetailed(FamilyProcessingContext ctx) {
        var (logs, err) = ctx.OperationLogs;
        var operationLogs = err != null ? [] : logs ?? [];

        // Create a lookup for operation metadata by name (handle duplicates by taking first)
        var metadataLookup = this._operationMetadata
            .GroupBy(op => op.Name)
            .ToDictionary(g => g.Key, g => g.First());

        return new {
            Family = ctx.FamilyName,
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            FamilyTotalSecondsElapsed = Math.Round(ctx.TotalMs / 1000.0, 3),
            FamilyPreCollectionSecondsElapsed = Math.Round(ctx.PreCollectionMs / 1000.0, 3),
            FamilyOperationsSecondsElapsed = Math.Round(ctx.OperationsMs / 1000.0, 3),
            FamilyPostCollectionSecondsElapsed = Math.Round(ctx.PostCollectionMs / 1000.0, 3),
            Error = err?.Message,
            Profile = this._profileName,
            Operations = operationLogs.Select(log => {
                var hasMeta = metadataLookup.TryGetValue(log.OperationName, out var meta);
                return new {
                    Name = log.OperationName,
                    Description = hasMeta ? meta.Description : null,
                    Type = hasMeta ? meta.Type : null,
                    IsMerged = hasMeta ? meta.IsMerged : null,
                    SecondsElapsed = Math.Round(log.MsElapsed / 1000.0, 3),
                    Successes = BuildMessages(log.Entries, LogStatus.Success),
                    Skipped = BuildMessages(log.Entries, LogStatus.Skipped),
                    Deferred = BuildMessages(log.Entries, LogStatus.Pending),
                    Errors = BuildMessages(log.Entries, LogStatus.Error)
                };
            }).ToList()
        };
    }

    private static List<string> BuildMessages(IEnumerable<LogEntry> entries, LogStatus status) =>
        entries.Where(e => e.Status == status)
            .GroupBy(e => new { e.Name, e.Message })
            .Select(g => {
                var contexts = g.Select(e => e.FamilyTypeName).Where(c => c != null).ToList();
                var contextsStr = contexts.Any() ? $"[{string.Join(", ", contexts)}] " : string.Empty;
                var messageStr = !string.IsNullOrEmpty(g.Key.Message) ? $" : {g.Key.Message}" : "";
                return $"{contextsStr}{g.Key.Name}{messageStr}";
            }).ToList();

    private static object BuildParameterDiff(FamilyProcessingContext ctx) {
        if (ctx.PreProcessSnapshot?.Parameters?.Data == null || ctx.PostProcessSnapshot?.Parameters?.Data == null)
            return new { Message = "No parameter snapshots available for comparison" };

        // Use composite key (Name + IsInstance) to handle duplicate parameter names
        var preParams = ctx.PreProcessSnapshot.Parameters.Data
            .GroupBy(p => (p.Name, p.IsInstance))
            .ToDictionary(g => g.Key, g => g.First());
        var postParams = ctx.PostProcessSnapshot.Parameters.Data
            .GroupBy(p => (p.Name, p.IsInstance))
            .ToDictionary(g => g.Key, g => g.First());

        var added = new List<object>();
        var removed = new List<string>();
        var modified = new List<object>();

        // Find added parameters
        foreach (var (key, postParam) in postParams) {
            if (!preParams.ContainsKey(key)) {
                added.Add(new {
                    Description = GetDescription(postParam),
                    Formula = postParam.Formula ?? null,
                    HasValueForAllTypes = postParam.Formula != null || postParam.HasValueForAllTypes()
                });
            }
        }

        // Find removed parameters
        foreach (var (key, preParam) in preParams) {
            if (!postParams.ContainsKey(key))
                removed.Add(GetDescription(preParam));
        }

        // Find modified parameters
        foreach (var (key, preParam) in preParams) {
            if (!postParams.TryGetValue(key, out var postParam))
                continue;

            var changes = new List<string>();

            // Check formula changes
            if (preParam.Formula != postParam.Formula) {
                var preFormula = string.IsNullOrWhiteSpace(preParam.Formula) ? "(none)" : preParam.Formula;
                var postFormula = string.IsNullOrWhiteSpace(postParam.Formula) ? "(none)" : postParam.Formula;
                changes.Add($"Formula: {preFormula} → {postFormula}");
            }

            // Check value changes per type
            var allTypes = preParam.ValuesPerType.Keys.Union(postParam.ValuesPerType.Keys).ToHashSet();
            var valueChanges = new Dictionary<string, string>();

            foreach (var typeName in allTypes) {
                var preValue = preParam.ValuesPerType.GetValueOrDefault(typeName);
                var postValue = postParam.ValuesPerType.GetValueOrDefault(typeName);

                if (preValue != postValue) {
                    var preDisplay = string.IsNullOrWhiteSpace(preValue) ? "(empty)" : preValue;
                    var postDisplay = string.IsNullOrWhiteSpace(postValue) ? "(empty)" : postValue;
                    valueChanges[typeName] = $"{preDisplay} → {postDisplay}";
                }
            }

            if (valueChanges.Any()) changes.Add($"Values changed for {valueChanges.Count} type(s)");

            // Check metadata changes
            if (preParam.IsInstance != postParam.IsInstance)
                changes.Add($"IsInstance: {preParam.IsInstance} → {postParam.IsInstance}");

            if (preParam.PropertiesGroup.TypeId != postParam.PropertiesGroup.TypeId)
                changes.Add($"Group: {GetPropGroupLabel(preParam)} → {GetPropGroupLabel(postParam)}");

            if (preParam.DataType.TypeId != postParam.DataType.TypeId)
                changes.Add($"DataType: {GetDataTypeLabel(preParam)} → {GetDataTypeLabel(postParam)}");

            if (changes.Any()) modified.Add(new { Description = GetDescription(preParam), Changes = changes });
        }

        return new {
            Family = ctx.FamilyName,
            Summary = new {
                ParametersRemoved = removed.Count,
                ParametersAdded = added.Count,
                ParametersModified = modified.Count
            },
            Removed = removed.Any() ? removed : null,
            Added = added.Any() ? added : null,
            Modified = modified.Any() ? modified : null
        };
    }


    private static void SerializeSnapshotSections(FamilySnapshot snapshot, OutputManager output, string prefix) {
        if (snapshot.Parameters?.Data != null && snapshot.Parameters.Data.Count > 0) {
            var paramsData = snapshot.Parameters.Data;
            _ = output.Json($"snapshot-parameters-{prefix}.json").Write(SortAndOrder(paramsData));
        }

        if (snapshot.RefPlanesAndDims != null) {
            var hasSpecs = snapshot.RefPlanesAndDims.MirrorSpecs.Count > 0 ||
                           snapshot.RefPlanesAndDims.OffsetSpecs.Count > 0;
            if (hasSpecs)
                _ = output.Json($"snapshot-refplanesanddims-{prefix}.json").Write(snapshot.RefPlanesAndDims);
        }
    }

    public static List<ParamSnapshot> SortAndOrder( List<ParamSnapshot> snapshots) {
        snapshots ??= [];
        return snapshots.Select(s => s with {
            ValuesPerType = new Dictionary<string, string>(
                s.ValuesPerType.OrderBy(kvp => kvp.Key, StringComparer.OrdinalIgnoreCase),
                StringComparer.Ordinal
            )
        }).ToList();
    }
    private static string SanitizeDirName(string name) {
        if (string.IsNullOrWhiteSpace(name))
            return "Unnamed";

        var invalid = Path.GetInvalidFileNameChars();
        var chars = name
            .Select(c => invalid.Contains(c) ? '_' : c)
            .ToArray();

        var sanitized = new string(chars).Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "Unnamed" : sanitized;
    }
}

/// <summary>
///     Builder for dry-run output.
/// </summary>
public class DryRunResultBuilder(Storage storage) {
    private readonly Storage _storage = storage;
    private List<SharedParameterDefinition> _apsParams = [];
    private List<Family> _families = [];
    private List<(string Name, string Description, string Type, string IsMerged)> _operationMetadata = [];
    private string _profileName;
    private object _profileSettings;

    public DryRunResultBuilder WithProfile<T>(T settings, string profileName) where T : BaseProfileSettings {
        this._profileSettings = settings;
        this._profileName = profileName;
        return this;
    }

    public DryRunResultBuilder WithApsParams(List<SharedParameterDefinition> apsParams) {
        this._apsParams = apsParams;
        return this;
    }

    public DryRunResultBuilder WithFamilies(List<Family> families) {
        this._families = families;
        return this;
    }

    public DryRunResultBuilder WithOperationMetadata(OperationQueue queue) {
        this._operationMetadata = queue.GetExecutableMetadata();
        return this;
    }

    private (object summary, object detailed) GenerateDryRunData() {
        var summary = new {
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            Profile = this._profileName,
            Operations = this._operationMetadata.Select(op =>
                new { Operation = $"[Batch {op.IsMerged}] ({op.Type}) {op.Name}", op.Description }).ToList(),
            ApsParameters = this._apsParams.Select(p => p.ExternalDefinition.Name).ToList(),
            Families = this._families.Select(f => f.Name).ToList(),
            Summary = new { TotalApsParameters = this._apsParams.Count, TotalFamilies = this._families.Count }
        };

        var detailed = new {
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            Profile = this._profileName,
            ProfileSettings = this._profileSettings,
            Operations = this._operationMetadata.Select(op =>
                new { Operation = $"[Batch {op.IsMerged}] ({op.Type}) {op.Name}", op.Description }).ToList(),
            ApsParameters =
                this._apsParams.Select(p => new {
                    p.ExternalDefinition.Name,
                    GUID = p.ExternalDefinition.GUID.ToString(),
                    GroupTypeId = p.GroupTypeId.TypeId,
                    DataType = p.ExternalDefinition.GetDataType().TypeId,
                    p.IsInstance,
                    p.ExternalDefinition.Description
                }).ToList(),
            Families = this._families.Select(f => new {
                f.Name,
                Id = f.Id.ToString(),
                CategoryName = f.FamilyCategory?.Name,
                CategoryId = f.FamilyCategory?.Id.ToString(),
                f.IsEditable,
                f.IsUserCreated
            }).ToList(),
            Summary = new { TotalApsParameters = this._apsParams.Count, TotalFamilies = this._families.Count }
        };

        return (summary, detailed);
    }
}