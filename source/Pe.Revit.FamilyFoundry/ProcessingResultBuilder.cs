using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.LookupTables;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.FamilyFoundry.Serialization;
using Pe.Revit.Global;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Shared.StorageRuntime;
using System.Collections;
using System.Reflection;

namespace Pe.Revit.FamilyFoundry;

/// <summary>
///     Writes run and family processing artifacts in a stable, verification-friendly shape.
/// </summary>
public class ProcessingResultBuilder(OutputStorage runOutput) {
    private readonly List<FamilyProcessingContext> _familyContexts = [];
    private readonly OutputStorage _runOutput = runOutput ?? throw new ArgumentNullException(nameof(runOutput));
    private List<(string Name, string Description, string Type, string IsMerged)> _operationMetadata = [];
    private FamilyMigrationReconciliationPlan? _desiredMigrationPlan;
    private string _profileName = string.Empty;
    private object _profilePayload = new { };

    public ProcessingResultBuilder(ModuleStorage storage) : this(storage.Output().TimestampedSubDir()) { }

    public string RunOutputPath => this._runOutput.DirectoryPath;

    private static string GetDescription(ParameterSnapshot param) =>
        $"{GetInstTypeStr(param)}: {param.Name} ({GetDataTypeLabel(param)})";

    private static string GetDataTypeLabel(ParameterSnapshot param) =>
        SpecNamesValueDomain.GetLabelForForge(param.DataType);

    private static string GetPropGroupLabel(ParameterSnapshot param) =>
        PropertyGroupNamesValueDomain.GetLabelForForge(param.PropertiesGroup);

    private static string GetInstTypeStr(ParameterSnapshot param) => param.IsInstance switch {
        true => "INST",
        false => "TYPE",
        null => "UNKNOWN"
    };

    public ProcessingResultBuilder WithProfile<T>(T profile, string profileName) where T : BaseProfile {
        this._profilePayload = profile;
        this._profileName = profileName;
        return this;
    }

    public ProcessingResultBuilder WithCustomProfile(object profile, string profileName) {
        this._profilePayload = profile;
        this._profileName = profileName;
        return this;
    }

    public ProcessingResultBuilder WithOperationMetadata(OperationQueue queue) {
        this._operationMetadata = queue.GetExecutableMetadata();
        return this;
    }

    public ProcessingResultBuilder WithDesiredMigrationPlan(FamilyMigrationReconciliationPlan plan) {
        this._desiredMigrationPlan = plan;
        return this;
    }

    public string WriteSingleFamilyOutput(FamilyProcessingContext ctx, bool openOnFinish = false) {
        if (!this._familyContexts.Contains(ctx))
            this._familyContexts.Add(ctx);

        var familyDirName = SanitizeDirName(ctx.FamilyName);
        var familyOutput = this._runOutput.SubDir(familyDirName);

        var inputProfilePath = familyOutput.Json("input-profile.json").Write(this._profilePayload);
        var operationPlanPath = familyOutput.Json("operation-plan.json").Write(this._operationMetadata
            .Select(op => new { op.Name, op.Description, op.Type, op.IsMerged }).ToList());
        var desiredMigrationPlanPath = this._desiredMigrationPlan == null
            ? null
            : familyOutput.Json("desired-migration-plan.json").Write(this._desiredMigrationPlan);
        var profileSummaryPath =
            familyOutput.Json("profile-summary.json").Write(BuildProfileSummary(this._profilePayload));
        var inputProfilePlanPath = this.WriteInputProfilePlanArtifact(familyOutput, this._profilePayload);

        var preSnapshotArtifacts = ctx.PreProcessSnapshot == null
            ? null
            : this.WriteSnapshotArtifacts(ctx.PreProcessSnapshot, familyOutput, "pre");
        var postSnapshotArtifacts = ctx.PostProcessSnapshot == null
            ? null
            : this.WriteSnapshotArtifacts(ctx.PostProcessSnapshot, familyOutput, "post");

        var abridgedPath = familyOutput.Json("logs-abridged.json").Write(BuildAbridged(ctx));
        var detailedPath = familyOutput.Json("logs-detailed.json").Write(this.BuildDetailed(ctx));
        var parameterEventsPath = familyOutput.Json("parameter-events.json").Write(this.BuildParameterEvents(ctx));
        var parameterDiffPath = familyOutput.Json("snapshot-parameters-diff.json").Write(BuildParameterDiff(ctx));
        var snapshotDiffPath = familyOutput.Json("snapshot-diff.json").Write(BuildSnapshotDiff(ctx));

        var artifactManifest = new FamilyArtifactManifest(
            familyDirName,
            this.RequiredRelativeToRun(inputProfilePath),
            this.RequiredRelativeToRun(profileSummaryPath),
            this.RequiredRelativeToRun(operationPlanPath),
            this.RelativeToRun(inputProfilePlanPath),
            this.RelativeToRun(desiredMigrationPlanPath),
            this.RequiredRelativeToRun(abridgedPath),
            this.RequiredRelativeToRun(detailedPath),
            string.Empty,
            this.RequiredRelativeToRun(parameterEventsPath),
            this.RequiredRelativeToRun(parameterDiffPath),
            this.RequiredRelativeToRun(snapshotDiffPath),
            preSnapshotArtifacts,
            postSnapshotArtifacts
        );

        ctx.Artifacts = artifactManifest;
        var familyReportPath = familyOutput.Json("family-report.json").Write(this.BuildFamilyReport(ctx));
        ctx.Artifacts = artifactManifest with { FamilyReportPath = this.RequiredRelativeToRun(familyReportPath) };

        if (openOnFinish)
            FileUtils.OpenInDefaultApp(familyReportPath);

        return familyReportPath;
    }

    public void WriteMultiFamilySummary(double totalMs, bool openOnFinish = false) {
        if (!this._familyContexts.Any())
            return;

        var totalErrors = this._familyContexts
            .SelectMany(ctx => {
                var (logs, err) = ctx.OperationLogs;
                if (err != null)
                    return [new LogEntry(ctx.FamilyName).Error(err.Message)];

                return logs?.SelectMany(log => log.Entries.Where(entry => entry.Status == LogStatus.Error)) ?? [];
            })
            .GroupBy(entry => new { entry.Name, entry.Message })
            .Count();

        var familySummaries = this._familyContexts.Select(ctx => {
            var (logs, err) = ctx.OperationLogs;
            var errorCount = err != null
                ? 1
                : logs?.SelectMany(log => log.Entries.Where(entry => entry.Status == LogStatus.Error))
                    .GroupBy(entry => new { entry.Name, entry.Message })
                    .Count() ?? 0;

            return new {
                Family = ctx.FamilyName,
                Status = err != null ? "Failed" : errorCount > 0 ? "Completed with errors" : "Success",
                SecondsElapsed = Math.Round(ctx.TotalMs / 1000.0, 3),
                ErrorCount = errorCount,
                ctx.Artifacts
            };
        }).ToList();

        var summary = new {
            Profile = this._profileName,
            ProfileType = this._profilePayload.GetType().Name,
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            TotalSecondsElapsed = Math.Round(totalMs / 1000.0, 3),
            Summary = new {
                TotalFamilies = this._familyContexts.Count,
                Successful = familySummaries.Count(family => family.Status == "Success"),
                CompletedWithErrors = familySummaries.Count(family => family.Status == "Completed with errors"),
                Failed = familySummaries.Count(family => family.Status == "Failed"),
                TotalErrors = totalErrors
            },
            ArtifactModel = new {
                FamilyReport = "family-report.json",
                DetailedLogs = "logs-detailed.json",
                AbridgedLogs = "logs-abridged.json",
                FullSnapshot = "snapshot-{phase}.json",
                SnapshotProjection = "snapshot-profile-{dense|empty-allowed}-{phase}.json",
                DesiredMigrationPlan = "desired-migration-plan.json",
                ParameterEvents = "parameter-events.json",
                SnapshotDiff = "snapshot-diff.json",
                ParameterDiff = "snapshot-parameters-diff.json"
            },
            Families = familySummaries
        };

        var summaryPath = this._runOutput.Json("run-summary.json").Write(summary);
        if (openOnFinish)
            FileUtils.OpenInDefaultApp(summaryPath);
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
        var metadataLookup = this._operationMetadata
            .GroupBy(op => op.Name)
            .ToDictionary(group => group.Key, group => group.First());

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

    private object BuildParameterEvents(FamilyProcessingContext ctx) {
        var (logs, err) = ctx.OperationLogs;
        var operationLogs = err != null ? [] : logs ?? [];
        var sequence = 0;
        var events = operationLogs
            .SelectMany(log => log.Entries
                .Where(entry => entry.ParameterEvent is not null)
                .Select(entry => {
                    var parameterEvent = entry.ParameterEvent!;
                    sequence++;
                    return new {
                        Sequence = sequence,
                        log.OperationName,
                        OperationStatus = entry.Status == LogStatus.Pending ? "Deferred" : entry.Status.ToString(),
                        entry.FamilyTypeName,
                        LogEntryName = entry.Name,
                        entry.Message,
                        Outcome = parameterEvent.Outcome.ToString(),
                        Reason = parameterEvent.Reason.ToString(),
                        parameterEvent.SourceParameter,
                        parameterEvent.TargetParameter,
                        parameterEvent.ParameterName,
                        parameterEvent.MappingKey,
                        parameterEvent.DataType,
                        parameterEvent.IsInstance,
                        parameterEvent.Details
                    };
                }))
            .ToList();

        return new {
            Family = ctx.FamilyName,
            Profile = this._profileName,
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            EventModelVersion = 1,
            Error = err?.Message,
            Events = events
        };
    }

    private object BuildFamilyReport(FamilyProcessingContext ctx) => new {
        Family = ctx.FamilyName,
        Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
        Profile =
            new {
                Name = this._profileName,
                Type = this._profilePayload.GetType().Name,
                Summary = BuildProfileSummary(this._profilePayload)
            },
        Timings = new {
            TotalSecondsElapsed = Math.Round(ctx.TotalMs / 1000.0, 3),
            PreCollectionSecondsElapsed = Math.Round(ctx.PreCollectionMs / 1000.0, 3),
            OperationsSecondsElapsed = Math.Round(ctx.OperationsMs / 1000.0, 3),
            PostCollectionSecondsElapsed = Math.Round(ctx.PostCollectionMs / 1000.0, 3)
        },
        Error = ctx.OperationLogs.AsTuple().error?.Message,
        ctx.Artifacts,
        SnapshotVerification = BuildSnapshotDiff(ctx),
        Operations = this.BuildDetailed(ctx)
    };

    private static List<string> BuildMessages(IEnumerable<LogEntry> entries, LogStatus status) =>
        entries.Where(entry => entry.Status == status)
            .GroupBy(entry => new { entry.Name, entry.Message })
            .Select(group => {
                var contexts = group.Select(entry => entry.FamilyTypeName).Where(context => context != null).ToList();
                var contextsStr = contexts.Any() ? $"[{string.Join(", ", contexts)}] " : string.Empty;
                var messageStr = !string.IsNullOrEmpty(group.Key.Message) ? $" : {group.Key.Message}" : string.Empty;
                return $"{contextsStr}{group.Key.Name}{messageStr}";
            }).ToList();

    private static object BuildParameterDiff(FamilyProcessingContext ctx) {
        if (ctx.PreProcessSnapshot?.Parameters?.Data == null || ctx.PostProcessSnapshot?.Parameters?.Data == null)
            return new { Message = "No parameter snapshots available for comparison" };

        var preParams = ctx.PreProcessSnapshot.Parameters.Data
            .GroupBy(param => (param.Name, param.IsInstance))
            .ToDictionary(group => group.Key, group => group.First());
        var postParams = ctx.PostProcessSnapshot.Parameters.Data
            .GroupBy(param => (param.Name, param.IsInstance))
            .ToDictionary(group => group.Key, group => group.First());

        var added = new List<object>();
        var removed = new List<string>();
        var modified = new List<object>();

        foreach (var (key, postParam) in postParams) {
            if (!preParams.ContainsKey(key)) {
                added.Add(new {
                    Description = GetDescription(postParam),
                    Formula = postParam.Formula ?? null,
                    HasValueForAllTypes = postParam.Formula != null || postParam.HasValueForAllTypes()
                });
            }
        }

        foreach (var (key, preParam) in preParams) {
            if (!postParams.ContainsKey(key))
                removed.Add(GetDescription(preParam));
        }

        foreach (var (key, preParam) in preParams) {
            if (!postParams.TryGetValue(key, out var postParam))
                continue;

            var changes = new List<string>();

            if (preParam.Formula != postParam.Formula) {
                var preFormula = string.IsNullOrWhiteSpace(preParam.Formula) ? "(none)" : preParam.Formula;
                var postFormula = string.IsNullOrWhiteSpace(postParam.Formula) ? "(none)" : postParam.Formula;
                changes.Add($"Formula: {preFormula} -> {postFormula}");
            }

            var allTypes = preParam.ValuesPerType.Keys.Union(postParam.ValuesPerType.Keys).ToHashSet();
            var valueChanges = new Dictionary<string, string>();

            foreach (var typeName in allTypes) {
                var preValue = preParam.ValuesPerType.GetValueOrDefault(typeName);
                var postValue = postParam.ValuesPerType.GetValueOrDefault(typeName);

                if (preValue != postValue) {
                    var preDisplay = string.IsNullOrWhiteSpace(preValue) ? "(empty)" : preValue;
                    var postDisplay = string.IsNullOrWhiteSpace(postValue) ? "(empty)" : postValue;
                    valueChanges[typeName] = $"{preDisplay} -> {postDisplay}";
                }
            }

            if (valueChanges.Any())
                changes.Add($"Values changed for {valueChanges.Count} type(s)");

            if (preParam.IsInstance != postParam.IsInstance)
                changes.Add($"IsInstance: {preParam.IsInstance} -> {postParam.IsInstance}");

            if (preParam.PropertiesGroup.TypeId != postParam.PropertiesGroup.TypeId)
                changes.Add($"Group: {GetPropGroupLabel(preParam)} -> {GetPropGroupLabel(postParam)}");

            if (preParam.DataType.TypeId != postParam.DataType.TypeId)
                changes.Add($"DataType: {GetDataTypeLabel(preParam)} -> {GetDataTypeLabel(postParam)}");

            if (changes.Any())
                modified.Add(new { Description = GetDescription(preParam), Changes = changes });
        }

        return new {
            Family = ctx.FamilyName,
            Summary = new {
                ParametersRemoved = removed.Count, ParametersAdded = added.Count, ParametersModified = modified.Count
            },
            Removed = removed.Any() ? removed : null,
            Added = added.Any() ? added : null,
            Modified = modified.Any() ? modified : null
        };
    }

    private static object BuildSnapshotDiff(FamilyProcessingContext ctx) {
        var preProjection = TryProjectSnapshotProfiles(ctx.PreProcessSnapshot);
        var postProjection = TryProjectSnapshotProfiles(ctx.PostProcessSnapshot);
        var preSummary = BuildSnapshotSummary(ctx.PreProcessSnapshot, preProjection);
        var postSummary = BuildSnapshotSummary(ctx.PostProcessSnapshot, postProjection);

        return new {
            Family = ctx.FamilyName,
            Pre = preSummary,
            Post = postSummary,
            Delta = new {
                ParameterCount = postSummary.ParameterCount - preSummary.ParameterCount,
                LookupTableCount = postSummary.LookupTableCount - preSummary.LookupTableCount,
                MirrorConstraintCount = postSummary.MirrorConstraintCount - preSummary.MirrorConstraintCount,
                OffsetConstraintCount = postSummary.OffsetConstraintCount - preSummary.OffsetConstraintCount,
                AuthoredPlanes =
                    postSummary.AuthoredParamDrivenSolids.Planes - preSummary.AuthoredParamDrivenSolids.Planes,
                AuthoredSpans =
                    postSummary.AuthoredParamDrivenSolids.Spans - preSummary.AuthoredParamDrivenSolids.Spans,
                AuthoredPrisms =
                    postSummary.AuthoredParamDrivenSolids.Prisms - preSummary.AuthoredParamDrivenSolids.Prisms,
                AuthoredCylinders =
                    postSummary.AuthoredParamDrivenSolids.Cylinders - preSummary.AuthoredParamDrivenSolids.Cylinders,
                AuthoredConnectors =
                    postSummary.AuthoredParamDrivenSolids.Connectors - preSummary.AuthoredParamDrivenSolids.Connectors
            },
            Parameters = BuildParameterDiff(ctx)
        };
    }

    private SnapshotArtifactManifest
        WriteSnapshotArtifacts(FamilySnapshot snapshot, OutputStorage output, string phase) {
        var snapshotPath = output.Json($"snapshot-{phase}.json").Write(snapshot);
        string? parameterProfilePath = null;
        if (snapshot.Parameters?.Data != null && snapshot.Parameters.Data.Count > 0) {
            var paramsData = snapshot.Parameters.Data;
            parameterProfilePath = output.Json($"snapshot-parameters-{phase}.json").Write(
                FamilyParamProfileAdapter.ProjectSnapshotsToProfile(
                    paramsData,
                    new FamilyParamProfileExportOptions { IncludeDefinitionOnlyParameters = true }));
        }

        string? lookupTablesPath = null;
        string? lookupTablesCsvPrefix = null;
        if (snapshot.LookupTables?.Data != null && snapshot.LookupTables.Data.Count > 0) {
            lookupTablesPath = output.Json($"snapshot-lookuptables-{phase}.json").Write(snapshot.LookupTables.Data);
            LookupTableArtifactWriter.WriteCsvFiles(
                snapshot.LookupTables.Data,
                output.DirectoryPath,
                $"snapshot-lookuptables-{phase}");
            lookupTablesCsvPrefix =
                this.RelativeToRun(Path.Combine(output.DirectoryPath, $"snapshot-lookuptables-{phase}"));
        }

        string? refPlanesAndDimsPath = null;
        if (snapshot.RefPlanesAndDims != null) {
            var hasConstraints = snapshot.RefPlanesAndDims.MirrorConstraintSnapshots.Count > 0 ||
                                 snapshot.RefPlanesAndDims.OffsetConstraintSnapshots.Count > 0;
            if (hasConstraints) {
                refPlanesAndDimsPath = output.Json($"snapshot-refplanesanddims-{phase}.json")
                    .Write(snapshot.RefPlanesAndDims);
            }
        }

        string? authoredParamDrivenSolidsPath = null;
        string? authoredParamDrivenSolidsPlanPath = null;
        if (snapshot.AuthoredParamDrivenSolids != null) {
            if (snapshot.AuthoredParamDrivenSolids.HasContent) {
                authoredParamDrivenSolidsPath = output.Json($"snapshot-authoredparamdrivensolids-{phase}.json")
                    .Write(snapshot.AuthoredParamDrivenSolids);
            }

            authoredParamDrivenSolidsPlanPath = WriteAuthoredSolidsPlanArtifact(
                output,
                $"snapshot-authoredparamdrivensolids-plan-{phase}.json",
                snapshot.AuthoredParamDrivenSolids);
        }

        var projection = TryProjectSnapshotProfiles(snapshot);
        var denseProjectionPath = projection?.DenseProfile == null
            ? null
            : output.Json($"snapshot-profile-dense-{phase}.json").Write(projection.DenseProfile);
        var emptyAllowedProjectionPath = projection?.EmptyAllowedProfile == null
            ? null
            : output.Json($"snapshot-profile-empty-allowed-{phase}.json").Write(projection.EmptyAllowedProfile);

        return new SnapshotArtifactManifest(
            phase,
            this.RequiredRelativeToRun(snapshotPath),
            this.RelativeToRun(parameterProfilePath),
            this.RelativeToRun(lookupTablesPath),
            lookupTablesCsvPrefix,
            this.RelativeToRun(refPlanesAndDimsPath),
            this.RelativeToRun(authoredParamDrivenSolidsPath),
            this.RelativeToRun(authoredParamDrivenSolidsPlanPath),
            this.RelativeToRun(denseProjectionPath),
            this.RelativeToRun(emptyAllowedProjectionPath)
        );
    }

    private string? WriteInputProfilePlanArtifact(OutputStorage output, object profilePayload) =>
        TryGetAuthoredParamDrivenSolids(profilePayload) is { } authoredSolids
            ? WriteAuthoredSolidsPlanArtifact(output, "input-profile-paramdrivensolids-plan.json", authoredSolids)
            : null;

    private static string? WriteAuthoredSolidsPlanArtifact(
        OutputStorage output,
        string fileName,
        AuthoredParamDrivenSolidsSettings? authoredSolids
    ) {
        if (authoredSolids == null)
            return null;

        var plan = AuthoredParamDrivenSolidsCompiler.Compile(authoredSolids);
        return output.Json(fileName).Write(new {
            Summary = BuildAuthoredParamDrivenSolidsSummary(authoredSolids),
            plan.CanExecute,
            Diagnostics = plan.Diagnostics.Select(diagnostic => new {
                diagnostic.Severity, diagnostic.SolidName, diagnostic.Path, diagnostic.Message
            }).ToList(),
            Plan = plan
        });
    }

    private static ReflectedSnapshotProjection? TryProjectSnapshotProfiles(FamilySnapshot? snapshot) {
        if (snapshot == null)
            return null;

        try {
            var sharedParameterNames = snapshot.Parameters?.Data?
                                           .Select(parameter => parameter.SharedGuid.HasValue
                                               ? parameter.Name?.Trim()
                                               : null)
                                           .OfType<string>()
                                           .Where(name => !string.IsNullOrWhiteSpace(name))
                                           .ToHashSet(StringComparer.Ordinal)
                                       ?? [];

            var projectorType = Type.GetType(
                "Pe.Revit.FamilyFoundry.Profiles.FamilySnapshotProfileProjector, Pe.Revit.FamilyFoundry");
            var projectProfiles = projectorType?.GetMethod(
                "ProjectProfiles",
                BindingFlags.Public | BindingFlags.Static);
            var projection = projectProfiles?.Invoke(
                null,
                [
                    snapshot,
                    string.IsNullOrWhiteSpace(snapshot.FamilyName) ? "__CURRENT_FAMILY__" : snapshot.FamilyName,
                    (Func<string, bool>)(name => sharedParameterNames.Contains(name))
                ]);
            if (projection == null)
                return null;

            var denseProfile = projection.GetType().GetProperty("DenseProfile")?.GetValue(projection);
            var emptyAllowedProfile = projection.GetType().GetProperty("EmptyAllowedProfile")?.GetValue(projection);
            return new ReflectedSnapshotProjection(denseProfile, emptyAllowedProfile);
        } catch {
            return null;
        }
    }

    private static SnapshotSummary BuildSnapshotSummary(
        FamilySnapshot? snapshot,
        ReflectedSnapshotProjection? projection
    ) => new(
        snapshot?.Parameters?.Data?.Count ?? 0,
        snapshot?.LookupTables?.Data?.Count ?? 0,
        snapshot?.RefPlanesAndDims?.MirrorConstraintSnapshots.Count ?? 0,
        snapshot?.RefPlanesAndDims?.OffsetConstraintSnapshots.Count ?? 0,
        BuildAuthoredParamDrivenSolidsSummary(snapshot?.AuthoredParamDrivenSolids),
        BuildProfileLikeSummary(projection?.DenseProfile),
        BuildProfileLikeSummary(projection?.EmptyAllowedProfile)
    );

    private static object BuildProfileSummary(object profilePayload) {
        if (profilePayload is BaseProfile baseProfile) {
            return new {
                ProfileType = profilePayload.GetType().Name,
                Execution = baseProfile.ExecutionOptions,
                IncludedFamilyCategories = baseProfile.FilterFamilies.IncludeCategoriesEqualing.Count,
                SharedShape = BuildProfileLikeSummary(profilePayload),
                MappingCount = TryGetListCount(profilePayload, "AddAndMapSharedParams", "MappingData"),
                MakeElectricalConnector = TryGetBool(profilePayload, "MakeElectricalConnector", "Enabled"),
                SortParams = TryGetBool(profilePayload, "SortParams", "Enabled")
            };
        }

        return new {
            ProfileType = profilePayload.GetType().Name, SharedShape = BuildProfileLikeSummary(profilePayload)
        };
    }

    private static ProfileLikeSummary BuildProfileLikeSummary(object? profile) =>
        profile == null
            ? new ProfileLikeSummary(false, 0, 0, 0, 0, BuildAuthoredParamDrivenSolidsSummary(null))
            : new ProfileLikeSummary(
                true,
                TryGetListCount(profile, "AddFamilyParams", "Parameters"),
                TryGetListCount(profile, "SetLookupTables", "Tables"),
                TryGetListCount(profile, "SetKnownParams", "GlobalAssignments"),
                TryGetListCount(profile, "SetKnownParams", "PerTypeAssignmentsTable"),
                BuildAuthoredParamDrivenSolidsSummary(TryGetAuthoredParamDrivenSolids(profile))
            );

    private static AuthoredParamDrivenSolidsSummary BuildAuthoredParamDrivenSolidsSummary(
        AuthoredParamDrivenSolidsSettings? authoredSolids
    ) => authoredSolids == null
        ? new AuthoredParamDrivenSolidsSummary(false, null, 0, 0, 0, 0, 0)
        : new AuthoredParamDrivenSolidsSummary(
            authoredSolids.HasContent,
            authoredSolids.Frame.ToString(),
            authoredSolids.Planes.Count,
            authoredSolids.Spans.Count,
            authoredSolids.Prisms.Count,
            authoredSolids.Cylinders.Count,
            authoredSolids.Connectors.Count
        );

    private string? RelativeToRun(string? absolutePath) =>
        string.IsNullOrWhiteSpace(absolutePath)
            ? null
            : GetRelativePathCompat(this._runOutput.DirectoryPath, absolutePath!);

    private string RequiredRelativeToRun(string? absolutePath) =>
        this.RelativeToRun(absolutePath)
        ?? throw new InvalidOperationException("Expected artifact path to resolve relative to run output.");

    private static AuthoredParamDrivenSolidsSettings? TryGetAuthoredParamDrivenSolids(object profilePayload) =>
        profilePayload.GetType().GetProperty("ParamDrivenSolids")?.GetValue(profilePayload) as
            AuthoredParamDrivenSolidsSettings;

    private static int TryGetListCount(object root, string propertyName, string nestedPropertyName) {
        var property = root.GetType().GetProperty(propertyName)?.GetValue(root);
        if (property == null)
            return 0;

        var nested = property.GetType().GetProperty(nestedPropertyName)?.GetValue(property);
        return nested switch {
            ICollection collection => collection.Count,
            _ => 0
        };
    }

    private static bool? TryGetBool(object root, string propertyName, string nestedPropertyName) {
        var property = root.GetType().GetProperty(propertyName)?.GetValue(root);
        var nested = property?.GetType().GetProperty(nestedPropertyName)?.GetValue(property);
        return nested as bool? ?? (nested is bool value ? value : null);
    }

    private static string SanitizeDirName(string name) {
        if (string.IsNullOrWhiteSpace(name))
            return "Unnamed";

        var invalid = Path.GetInvalidFileNameChars();
        var chars = name
            .Select(character => invalid.Contains(character) ? '_' : character)
            .ToArray();

        var sanitized = new string(chars).Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "Unnamed" : sanitized;
    }

    private static string GetRelativePathCompat(string relativeTo, string path) {
        var basePath = Path.GetFullPath(relativeTo);
        if (!basePath.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal))
            basePath += Path.DirectorySeparatorChar;

        var targetPath = Path.GetFullPath(path);
        var relativeUri = new Uri(basePath).MakeRelativeUri(new Uri(targetPath));
        return Uri.UnescapeDataString(relativeUri.ToString())
            .Replace('/', Path.DirectorySeparatorChar);
    }
}

public sealed record FamilyArtifactManifest(
    string FamilyDirectory,
    string InputProfilePath,
    string ProfileSummaryPath,
    string OperationPlanPath,
    string? InputProfileParamDrivenSolidsPlanPath,
    string? DesiredMigrationPlanPath,
    string LogsAbridgedPath,
    string LogsDetailedPath,
    string FamilyReportPath,
    string ParameterEventsPath,
    string ParameterDiffPath,
    string SnapshotDiffPath,
    SnapshotArtifactManifest? PreSnapshot,
    SnapshotArtifactManifest? PostSnapshot
);

public sealed record SnapshotArtifactManifest(
    string Phase,
    string SnapshotPath,
    string? ParameterProfilePath,
    string? LookupTablesPath,
    string? LookupTablesCsvPrefix,
    string? RefPlanesAndDimsPath,
    string? AuthoredParamDrivenSolidsPath,
    string? AuthoredParamDrivenSolidsPlanPath,
    string? ProjectedDenseProfilePath,
    string? ProjectedEmptyAllowedProfilePath
);

public sealed record AuthoredParamDrivenSolidsSummary(
    bool HasContent,
    string? Frame,
    int Planes,
    int Spans,
    int Prisms,
    int Cylinders,
    int Connectors
);

public sealed record ProfileLikeSummary(
    bool Available,
    int FamilyParams,
    int LookupTables,
    int GlobalAssignments,
    int PerTypeAssignmentRows,
    AuthoredParamDrivenSolidsSummary AuthoredParamDrivenSolids
);

public sealed record SnapshotSummary(
    int ParameterCount,
    int LookupTableCount,
    int MirrorConstraintCount,
    int OffsetConstraintCount,
    AuthoredParamDrivenSolidsSummary AuthoredParamDrivenSolids,
    ProfileLikeSummary ProjectedDenseProfile,
    ProfileLikeSummary ProjectedEmptyAllowedProfile
);

public sealed record ReflectedSnapshotProjection(object? DenseProfile, object? EmptyAllowedProfile);

/// <summary>
///     Builder for dry-run output.
/// </summary>
public class DryRunResultBuilder(ModuleStorage storage) {
    private readonly ModuleStorage _storage = storage;
    private List<SharedParameterDefinition> _apsParams = [];
    private List<Family> _families = [];
    private List<(string Name, string Description, string Type, string IsMerged)> _operationMetadata = [];
    private string _profileName = string.Empty;
    private object _profilePayload = new { };

    public DryRunResultBuilder WithProfile<T>(T profile, string profileName) where T : BaseProfile {
        this._profilePayload = profile;
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
            ApsParameters = this._apsParams.Select(param => param.ExternalDefinition.Name).ToList(),
            Families = this._families.Select(family => family.Name).ToList(),
            Summary = new { TotalApsParameters = this._apsParams.Count, TotalFamilies = this._families.Count }
        };

        var detailed = new {
            Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            Profile = this._profileName,
            ProfileSettings = this._profilePayload,
            Operations = this._operationMetadata.Select(op =>
                new { Operation = $"[Batch {op.IsMerged}] ({op.Type}) {op.Name}", op.Description }).ToList(),
            ApsParameters =
                this._apsParams.Select(param => new {
                    param.ExternalDefinition.Name,
                    GUID = param.ExternalDefinition.GUID.ToString(),
                    GroupTypeId = param.GroupTypeId.TypeId,
                    DataType = param.ExternalDefinition.GetDataType().TypeId,
                    param.IsInstance,
                    param.ExternalDefinition.Description
                }).ToList(),
            Families = this._families.Select(family => new {
                family.Name,
                Id = family.Id.ToString(),
                CategoryName = family.FamilyCategory?.Name,
                CategoryId = family.FamilyCategory?.Id.ToString(),
                family.IsEditable,
                family.IsUserCreated
            }).ToList(),
            Summary = new { TotalApsParameters = this._apsParams.Count, TotalFamilies = this._families.Count }
        };

        return (summary, detailed);
    }
}

