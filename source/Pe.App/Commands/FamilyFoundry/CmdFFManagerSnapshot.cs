using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.FamilyFoundry.Serialization;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Revit.Global.Revit.Ui;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime;
using Serilog.Events;
using System.Diagnostics;
using System.IO;
using RuntimeStorageClient = Pe.Shared.StorageRuntime.StorageClient;

namespace Pe.Tools.Commands.FamilyFoundry;

/// <summary>
///     Creates a snapshot profile from the current family state.
///     Output can be placed directly in the profiles folder and run with CmdFFManager.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdFFManagerSnapshot : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSetf
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var uiApp = commandData.Application;
        var doc = uiDoc.Document;

        try {
            var storage = RuntimeStorageClient.Default.Module(CmdFFManager.AddinKey);

            var snapshot = CollectFamilySnapshot(doc);
            if (snapshot == null) {
                new Ballogger()
                    .Add(LogEventLevel.Error, new StackFrame(), "Failed to collect family snapshot")
                    .Show();
                return Result.Cancelled;
            }

            var profile = ConvertSnapshotToProfile(doc, snapshot);
            var outputDir = storage.Output().TimestampedSubDir();
            var profileName = $"{snapshot.FamilyName}-snapshot.json";
            var outputPath = outputDir.Json(profileName).Write(profile);
            var replayFamilyPath = CreateReplayFamily(uiApp, doc, snapshot, profile, outputDir.DirectoryPath);

            new Ballogger()
                .Add(LogEventLevel.Information, new StackFrame(),
                    $"Created snapshot profile for {snapshot.FamilyName}")
                .Show();

            if (!string.IsNullOrWhiteSpace(replayFamilyPath))
                _ = uiApp.OpenAndActivateDocument(replayFamilyPath);
            else if (outputPath != null)
                FileUtils.OpenInDefaultApp(outputPath);

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private static FamilySnapshot CollectFamilySnapshot(Document doc) {
        if (!doc.IsFamilyDocument)
            return null;

        var famDoc = new FamilyDocument(doc);
        var familyName = Path.GetFileNameWithoutExtension(doc.PathName);
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = doc.Title ?? "Unnamed";

        var snapshot = new FamilySnapshot { FamilyName = familyName };

        var paramCollector = new ParamSectionCollector();
        if (((IFamilyDocCollector)paramCollector).ShouldCollect(snapshot))
            ((IFamilyDocCollector)paramCollector).Collect(snapshot, famDoc);

        var refPlaneCollector = new RefPlaneSectionCollector();
        if (refPlaneCollector.ShouldCollect(snapshot))
            refPlaneCollector.Collect(snapshot, famDoc);

        var extrusionCollector = new ExtrusionSectionCollector();
        if (extrusionCollector.ShouldCollect(snapshot))
            extrusionCollector.Collect(snapshot, famDoc);

        return snapshot;
    }

    private static ProfileFamilyManager ConvertSnapshotToProfile(Document doc, FamilySnapshot snapshot) {
        var paramSnapshots = snapshot.Parameters?.Data ?? [];
        var exportedParams = FamilyParamProfileAdapter.CreateFromSnapshots(paramSnapshots);
        var authoredSolids = snapshot.ParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings();
        var compiledSolids = AuthoredParamDrivenSolidsCompiler.Compile(authoredSolids);
        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.InternalExtrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.Connectors))
            .ToList();
        var referencedSnapshotDefinitions = KnownParamPlanBuilder.BuildFamilyDefinitionsFromSnapshots(
            paramSnapshots,
            additionalReferences);
        var resolvedFamilyParams = KnownParamPlanBuilder.MergeFamilyParamDefinitions(
            exportedParams.AddFamilyParams,
            referencedSnapshotDefinitions);
        var requiredApsParameterNames = exportedParams.SetKnownParams.GetAllReferencedParameterNames()
            .Concat(additionalReferences)
            .Where(KnownParamResolver.IsPeParameterName)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        return new ProfileFamilyManager {
            ExecutionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = true },
            FilterFamilies = new BaseProfileSettings.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeCategoriesEqualing = [],
                IncludeNames = new IncludeFamilies { Equaling = [snapshot.FamilyName] },
                ExcludeNames = new ExcludeFamilies()
            },
            FilterApsParams = new BaseProfileSettings.FilterApsParamsSettings {
                IncludeNames = new IncludeSharedParameter { Equaling = requiredApsParameterNames },
                ExcludeNames = new ExcludeSharedParameter()
            },
            AddFamilyParams = resolvedFamilyParams,
            SetKnownParams = exportedParams.SetKnownParams,
            ParamDrivenSolids = authoredSolids
        };
    }

    private static string? CreateReplayFamily(
        UIApplication uiApp,
        Document sourceDoc,
        FamilySnapshot snapshot,
        ProfileFamilyManager profile,
        string outputDirectory
    ) {
        var replayDoc = CreateReplayFamilyDocument(uiApp, sourceDoc, $"{snapshot.FamilyName} Snapshot");
        if (replayDoc == null)
            return null;

        try {
            var result = CmdFFManager.ProcessFamiliesCore(
                replayDoc,
                profile,
                $"{snapshot.FamilyName}-snapshot-replay",
                new LoadAndSaveOptions {
                    OpenOutputFilesOnCommandFinish = false,
                    LoadFamily = false,
                    SaveFamilyToInternalPath = false,
                    SaveFamilyToOutputDir = true
                },
                outputDirectory);

            if (!result.Success || string.IsNullOrWhiteSpace(result.OutputFolderPath))
                throw new InvalidOperationException(result.Error ?? "Snapshot replay family processing failed.");

            return GetReplaySavedFamilyPath(result.OutputFolderPath, replayDoc);
        } finally {
            if (replayDoc.IsValidObject)
                _ = replayDoc.Close(false);
        }
    }

    private static Document? CreateReplayFamilyDocument(
        UIApplication uiApp,
        Document sourceDoc,
        string replayFamilyName
    ) {
        var templatePath = ResolveReplayTemplatePath(uiApp.Application, sourceDoc);
        if (string.IsNullOrWhiteSpace(templatePath) || !File.Exists(templatePath))
            return null;

        var replayDoc = uiApp.Application.NewFamilyDocument(templatePath);
        if (replayDoc == null)
            return null;

        using var transaction = new Transaction(replayDoc, "Configure replay family");
        _ = transaction.Start();
        replayDoc.OwnerFamily.Name = replayFamilyName.Trim();

        var sourceCategory = sourceDoc.OwnerFamily?.FamilyCategory;
        if (sourceCategory != null) {
            var replayCategory = Category.GetCategory(replayDoc, sourceCategory.Id);
            if (replayCategory != null)
                replayDoc.OwnerFamily.FamilyCategory = replayCategory;
        }

        _ = transaction.Commit();
        return replayDoc;
    }

    private static string? ResolveReplayTemplatePath(
        Autodesk.Revit.ApplicationServices.Application application,
        Document sourceDoc
    ) {
        var templateRoot = application.FamilyTemplatePath;
        if (string.IsNullOrWhiteSpace(templateRoot) || !Directory.Exists(templateRoot))
            return null;

        var templates = Directory.GetFiles(templateRoot, "*.rft", SearchOption.AllDirectories).ToList();
        if (templates.Count == 0)
            return null;

        var preferredTemplateNames = GetPreferredTemplateNames(sourceDoc.OwnerFamily?.FamilyCategory?.Name);
        foreach (var templateName in preferredTemplateNames) {
            var match = templates.FirstOrDefault(path =>
                string.Equals(Path.GetFileName(path), templateName, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(match))
                return match;
        }

        return templates.FirstOrDefault();
    }

    private static IReadOnlyList<string> GetPreferredTemplateNames(string? categoryName) {
        var normalized = categoryName?.Trim() ?? string.Empty;
        if (normalized.Contains("Electrical", StringComparison.OrdinalIgnoreCase)) {
            return [
                "Electrical Equipment.rft",
                "Metric Electrical Equipment.rft",
                "Generic Model.rft",
                "Metric Generic Model.rft"
            ];
        }

        if (normalized.Contains("Mechanical", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("Air", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("Terminal", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("Duct", StringComparison.OrdinalIgnoreCase)) {
            return [
                "Mechanical Equipment.rft",
                "Metric Mechanical Equipment.rft",
                "Generic Model.rft",
                "Metric Generic Model.rft"
            ];
        }

        if (normalized.Contains("Specialty", StringComparison.OrdinalIgnoreCase)) {
            return [
                "Specialty Equipment.rft",
                "Metric Specialty Equipment.rft",
                "Generic Model.rft",
                "Metric Generic Model.rft"
            ];
        }

        return [
            "Generic Model.rft",
            "Metric Generic Model.rft",
            "Mechanical Equipment.rft",
            "Metric Mechanical Equipment.rft"
        ];
    }

    private static string GetReplaySavedFamilyPath(string outputDirectory, Document replayDoc) {
        var familyName = replayDoc.OwnerFamily?.Name;
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = Path.GetFileNameWithoutExtension(replayDoc.Title);
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = "Family";

        var safeFamilyName = SanitizePathSegment(familyName);
        return Path.Combine(outputDirectory, safeFamilyName, $"{safeFamilyName}.rfa");
    }

    private static string SanitizePathSegment(string value) {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(ch => invalidChars.Contains(ch) ? '_' : ch).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "Family" : sanitized;
    }
}
