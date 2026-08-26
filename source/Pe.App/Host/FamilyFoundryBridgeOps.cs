using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Pe.Revit;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Revit.Global;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.StorageRuntime;
using System.IO;

namespace Pe.App.Host;

internal static class FamilyFoundryBridgeOps {
    private static readonly JsonSerializerSettings StrictProfileSettings = CreateStrictProfileSettings();
    private static readonly JsonSerializerSettings ProfileOutputSettings =
        RevitJsonFormatting.CreateRevitIndentedSettings();

    [Op("familyfoundry.plan", Does = "Strictly compile inline desired-state Family Foundry profile JSON into per-family reconciliation plans with provenance and a deterministic drift hash.", Title = "Plan Family Foundry Migration", Finds = ["family-foundry", "familyfoundry", "migration", "plan", "provenance", "plan-hash"], Cost = OpCost.Bounded, RequiresDocument = true, DocumentKind = OpDocumentKind.Project)]
    private static Task<FamilyFoundryPlanData> Plan(FamilyFoundryPlanRequest request, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => PlanFamilies(request), cancellationToken);

    [Op("familyfoundry.apply", Does = "Recompile inline desired-state Family Foundry profile JSON, refuse plan drift, then migrate each explicit loaded family independently with receipts.", Title = "Apply Family Foundry Migration", Finds = ["family-foundry", "familyfoundry", "migration", "apply", "plan-hash", "receipts"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, RequiresDocument = true, DocumentKind = OpDocumentKind.Project)]
    private static Task<FamilyFoundryApplyData> Apply(FamilyFoundryApplyRequest request, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => ApplyFamilies(request), cancellationToken);

    [Op("familyfoundry.project", Does = "Open selected loaded families read-only, capture full snapshots, and return dense runnable FFManagerProfile JSON inline.", Title = "Project Family Foundry Profiles", Finds = ["family-foundry", "familyfoundry", "project", "snapshot", "profile", "manager"], Cost = OpCost.Expensive, RequiresDocument = true, DocumentKind = OpDocumentKind.Project)]
    private static Task<FamilyFoundryProjectData> Project(FamilyFoundryProjectRequest request, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => ProjectFamilies(request), cancellationToken);

    private static FamilyFoundryPlanData PlanFamilies(FamilyFoundryPlanRequest request) {
        var parsed = ParseProfile(request.ProfileJson);
        if (parsed.Profile == null)
            return new FamilyFoundryPlanData(null, [], parsed.Diagnostics);

        var document = GetProjectDocument();
        FamilyFoundryReconciliationPlanData projectedPlan;
        try {
            projectedPlan = ProjectPlan(document.CompileDesiredFamilyMigrationProfile(parsed.Profile));
        } catch (Exception exception) {
            return new FamilyFoundryPlanData(null, [], [Diagnostic(
                "PlanCompilationFailed",
                "$.profileJson",
                exception.Message,
                "Correct the profile or refresh the Family Foundry parameter cache, then plan again.")]);
        }

        var families = ResolvePlanFamilies(document, parsed.Profile, request.FamilyId);
        if (families.Families.Count == 0)
            return new FamilyFoundryPlanData(null, [], families.Diagnostics);

        var planHash = FamilyFoundryPlanHasher.Compute(projectedPlan);
        return new FamilyFoundryPlanData(
            planHash,
            families.Families
                .Select(family => new FamilyFoundryFamilyPlanData(family.Id.Value(), family.Name, projectedPlan))
                .ToList(),
            families.Diagnostics);
    }

    private static FamilyFoundryApplyData ApplyFamilies(FamilyFoundryApplyRequest request) {
        var parsed = ParseProfile(request.ProfileJson);
        if (parsed.Profile == null)
            return new FamilyFoundryApplyData(null, true, [], parsed.Diagnostics);

        if (request.FamilyIds == null || request.FamilyIds.Count == 0) {
            return new FamilyFoundryApplyData(null, true, [], [Diagnostic(
                "FamilyIdsRequired",
                "$.familyIds",
                "At least one explicit family id is required.")]);
        }

        if (string.IsNullOrWhiteSpace(request.ExpectedPlanHash)) {
            return new FamilyFoundryApplyData(null, true, [], [Diagnostic(
                "ExpectedPlanHashRequired",
                "$.expectedPlanHash",
                "expectedPlanHash is required; call familyfoundry.plan immediately before apply.")]);
        }

        var document = GetProjectDocument();
        FamilyFoundryReconciliationPlanData projectedPlan;
        try {
            projectedPlan = ProjectPlan(document.CompileDesiredFamilyMigrationProfile(parsed.Profile));
        } catch (Exception exception) {
            return new FamilyFoundryApplyData(null, true, [], [Diagnostic(
                "PlanCompilationFailed",
                "$.profileJson",
                exception.Message,
                "Correct the profile or refresh the Family Foundry parameter cache, then plan again.")]);
        }

        var planHash = FamilyFoundryPlanHasher.Compute(projectedPlan);
        if (!string.Equals(planHash, request.ExpectedPlanHash.Trim(), StringComparison.OrdinalIgnoreCase)) {
            return new FamilyFoundryApplyData(planHash, true, [], [Diagnostic(
                "PlanHashMismatch",
                "$.expectedPlanHash",
                $"The expected plan hash '{request.ExpectedPlanHash}' does not match the recompiled hash '{planHash}'.",
                "Review the new plan and apply again with its planHash.")]);
        }

        var runOutput = StorageClient.Default
            .Module(FamilyModelSettingsRegistration.ModuleKey)
            .Output()
            .TimestampedSubDir("host-apply");
        var receipts = request.FamilyIds
            .Distinct()
            .Select(familyId => ApplyFamily(document, parsed.Profile, familyId, runOutput))
            .ToList();
        return new FamilyFoundryApplyData(planHash, false, receipts, []);
    }

    private static FamilyFoundryApplyReceipt ApplyFamily(
        Document document,
        DesiredFamilyMigrationProfile profile,
        long familyId,
        OutputStorage runOutput
    ) {
        if (document.GetElement(familyId.ToElementId()) is not Family family) {
            return FailedReceipt(familyId, null,
                $"Element id {familyId} is not a loaded family in the active project.");
        }

        try {
            var result = document.ApplyDesiredFamilyMigrationProfile(
                profile,
                "inline-host-profile",
                [family],
                new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false },
                runOutput);
            return BuildReceipt(familyId, family.Name, result, result.Contexts?.SingleOrDefault());
        } catch (Exception exception) {
            return FailedReceipt(familyId, family.Name, exception.Message);
        }
    }

    private static FamilyFoundryApplyReceipt BuildReceipt(
        long familyId,
        string familyName,
        FamilyMigrationApplyResult result,
        FamilyProcessingContext? context
    ) {
        var artifactDirectory = string.IsNullOrWhiteSpace(result.OutputFolderPath) || context?.Artifacts == null
            ? null
            : Path.Combine(result.OutputFolderPath, context.Artifacts.FamilyDirectory);
        List<OperationLog>? logs = null;
        Exception? contextError;
        if (context == null) {
            contextError = new InvalidOperationException(result.Error ?? "No family result was returned.");
        } else {
            (logs, contextError) = context.OperationLogs.AsTuple();
        }
        var operationsRun = logs?
            .Select(log => log.OperationName)
            .Distinct(StringComparer.Ordinal)
            .ToList() ?? [];
        var logErrors = logs?
            .SelectMany(log => log.Entries)
            .Where(entry => entry.Status == LogStatus.Error)
            .Select(entry => entry.Message)
            .Where(message => !string.IsNullOrWhiteSpace(message))
            .ToList() ?? [];
        var error = contextError?.Message
                    ?? (logErrors.Count == 0 ? result.Error : string.Join(Environment.NewLine, logErrors));
        var diff = BuildParameterDiff(context);
        return new FamilyFoundryApplyReceipt(
            familyId,
            familyName,
            result.Success && string.IsNullOrWhiteSpace(error),
            error,
            operationsRun,
            diff.Added + diff.Removed + diff.Modified,
            diff,
            artifactDirectory);
    }

    private static FamilyFoundryProjectData ProjectFamilies(FamilyFoundryProjectRequest request) {
        var document = GetProjectDocument();
        if (request.FamilyIds == null || request.FamilyIds.Count == 0) {
            return new FamilyFoundryProjectData([], [Diagnostic(
                "FamilyIdsRequired",
                "$.familyIds",
                "At least one explicit family id is required.")]);
        }

        var projections = request.FamilyIds
            .Distinct()
            .Select(familyId => ProjectFamily(document, familyId))
            .ToList();
        return new FamilyFoundryProjectData(projections, []);
    }

    private static FamilyFoundryProfileProjectionData ProjectFamily(Document projectDocument, long familyId) {
        if (projectDocument.GetElement(familyId.ToElementId()) is not Family family) {
            return new FamilyFoundryProfileProjectionData(
                familyId,
                null,
                false,
                null,
                $"Element id {familyId} is not a loaded family in the active project.");
        }

        Document? familyDocument = null;
        var shouldClose = false;
        try {
            var existingFamilyDocument = projectDocument.Application.FindOpenFamilyDocument(family);
            familyDocument = existingFamilyDocument ?? projectDocument.EditFamily(family);
            shouldClose = existingFamilyDocument == null;
            var snapshot = familyDocument.CaptureFamilySnapshot();
            var profile = FamilySnapshotProfileProjector.ProjectToProfile(snapshot, family.Name);
            var profileJson = JsonConvert.SerializeObject(profile, ProfileOutputSettings);
            return new FamilyFoundryProfileProjectionData(familyId, family.Name, true, profileJson, null);
        } catch (Exception exception) {
            return new FamilyFoundryProfileProjectionData(familyId, family.Name, false, null, exception.Message);
        } finally {
            if (shouldClose && familyDocument != null)
                _ = familyDocument.Close(false);
        }
    }

    private static Document GetProjectDocument() {
        var document = RevitUiSession.CurrentUIApplication.ActiveUIDocument?.Document
                       ?? throw BridgeOperationExceptions.Conflict("No active Revit document.");
        if (document.IsFamilyDocument)
            throw BridgeOperationExceptions.Conflict("The active Revit document is not a project document.");
        return document;
    }

    private static (DesiredFamilyMigrationProfile? Profile, IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics)
        ParseProfile(string? profileJson) {
        if (string.IsNullOrWhiteSpace(profileJson)) {
            return (null, [Diagnostic(
                "ProfileJsonRequired",
                "$.profileJson",
                "profileJson is required and must contain an inline DesiredFamilyMigrationProfile document.")]);
        }

        try {
            var profile = JsonConvert.DeserializeObject<DesiredFamilyMigrationProfile>(
                profileJson,
                StrictProfileSettings);
            return profile == null
                ? (null, [Diagnostic("InvalidProfileJson", "$.profileJson", "Profile JSON resolved to null.")])
                : (profile, []);
        } catch (JsonException exception) {
            return (null, [Diagnostic(
                "InvalidProfileJson",
                ProfilePath(JsonPath(exception)),
                exception.Message,
                "Remove unknown or stale fields and retry with a current DesiredFamilyMigrationProfile shape.")]);
        }
    }

    private static (List<Family> Families, IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics) ResolvePlanFamilies(
        Document document,
        DesiredFamilyMigrationProfile profile,
        long? familyId
    ) {
        if (familyId == null)
            return (profile.GetFamilies(document), []);
        if (document.GetElement(familyId.Value.ToElementId()) is Family family)
            return ([family], []);
        return ([], [Diagnostic(
            "FamilyNotFound",
            "$.familyId",
            $"Element id {familyId.Value} is not a loaded family in the active project.")]);
    }

    private static FamilyFoundryReconciliationPlanData ProjectPlan(FamilyMigrationReconciliationPlan plan) => new(
        plan.Parameters.Select(parameter => new FamilyFoundryResolvedParameterData(
            new FamilyFoundryResolvedParameterDefinitionData(
                parameter.Definition.Identity,
                parameter.Definition.Name,
                parameter.Definition.DataType.TypeId,
                parameter.Definition.PropertiesGroup.TypeId,
                parameter.Definition.IsInstance,
                parameter.Definition.Tooltip),
            parameter.IsShared,
            parameter.Assignment == null
                ? null
                : new FamilyFoundryAssignmentData(
                    parameter.Assignment.Kind.ToString(),
                    parameter.Assignment.Value),
            new SortedDictionary<string, string?>(
                parameter.ValuesByType.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
                StringComparer.Ordinal),
            parameter.Migration == null
                ? null
                : new FamilyFoundryMigrationData(
                    parameter.Migration.SourceNames,
                    parameter.Migration.OnlyAddIfSourceExists,
                    parameter.Migration.MappingStrategy),
            new FamilyFoundryParameterProvenanceData(
                parameter.Provenance.Identity.ToString(),
                parameter.Provenance.DataType.ToString(),
                parameter.Provenance.PropertiesGroup.ToString(),
                parameter.Provenance.IsInstance.ToString(),
                parameter.Provenance.Tooltip.ToString())))
            .ToList(),
        plan.RequiredApsParameterNames.ToList(),
        plan.FamilyParameterNames.ToList(),
        plan.LoweredActions.Select(action => new FamilyFoundryLoweredActionData(
            action.Operation,
            action.Target,
            action.Sources,
            action.Reason)).ToList());

    private static FamilyFoundryApplyReceipt FailedReceipt(long familyId, string? familyName, string error) => new(
        familyId,
        familyName,
        false,
        error,
        [],
        0,
        new FamilyFoundryParameterDiffSummary(0, 0, 0),
        null);

    private static FamilyFoundryParameterDiffSummary BuildParameterDiff(FamilyProcessingContext? context) {
        var before = context?.PreProcessSnapshot?.Parameters?.Data;
        var after = context?.PostProcessSnapshot?.Parameters?.Data;
        if (before == null || after == null)
            return new FamilyFoundryParameterDiffSummary(0, 0, 0);

        var beforeByKey = before
            .GroupBy(parameter => (parameter.Name, parameter.IsInstance))
            .ToDictionary(group => group.Key, group => group.First());
        var afterByKey = after
            .GroupBy(parameter => (parameter.Name, parameter.IsInstance))
            .ToDictionary(group => group.Key, group => group.First());
        var added = afterByKey.Keys.Count(key => !beforeByKey.ContainsKey(key));
        var removed = beforeByKey.Keys.Count(key => !afterByKey.ContainsKey(key));
        var modified = beforeByKey.Count(pair =>
            afterByKey.TryGetValue(pair.Key, out var current) && ParameterChanged(pair.Value, current));
        return new FamilyFoundryParameterDiffSummary(added, removed, modified);
    }

    private static bool ParameterChanged(ParameterSnapshot before, ParameterSnapshot after) =>
        !string.Equals(before.Formula, after.Formula, StringComparison.Ordinal)
        || !string.Equals(before.DataType.TypeId, after.DataType.TypeId, StringComparison.Ordinal)
        || !string.Equals(before.PropertiesGroup.TypeId, after.PropertiesGroup.TypeId, StringComparison.Ordinal)
        || before.ValuesPerType.Count != after.ValuesPerType.Count
        || before.ValuesPerType.Any(pair =>
            !after.ValuesPerType.TryGetValue(pair.Key, out var value)
            || !string.Equals(pair.Value, value, StringComparison.Ordinal));

    private static FamilyFoundryDiagnostic Diagnostic(
        string code,
        string path,
        string message,
        string? suggestion = null
    ) => new(code, path, message, suggestion);

    private static string ProfilePath(string? path) =>
        string.IsNullOrWhiteSpace(path) ? "$.profileJson" : $"$.profileJson.{path}";

    private static string? JsonPath(JsonException exception) => exception switch {
        JsonSerializationException serializationException => serializationException.Path,
        JsonReaderException readerException => readerException.Path,
        _ => null
    };

    private static JsonSerializerSettings CreateStrictProfileSettings() {
        var settings = RevitJsonFormatting.CreateRequiredAwareRevitIndentedSettings();
        settings.MissingMemberHandling = MissingMemberHandling.Error;
        return settings;
    }

}
