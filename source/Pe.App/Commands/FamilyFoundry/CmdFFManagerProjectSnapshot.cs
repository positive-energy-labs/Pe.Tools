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
///     Captures the current family state and projects it to an FF profile.
///     Output can be placed directly in the profiles folder and run with CmdFFManager.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdFFManagerProjectSnapshot : IExternalCommand {
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

            var profile = ProjectSnapshotToProfile(doc, snapshot);
            var outputDir = storage.Output().TimestampedSubDir();
            var profileName = $"{snapshot.FamilyName}-snapshot.json";
            var outputPath = outputDir.Json(profileName).Write(profile);
            Pe.Revit.FamilyFoundry.LookupTables.LookupTableArtifactWriter.WriteCsvFiles(
                profile.SetLookupTables.Tables,
                outputDir.DirectoryPath,
                "lookup-tables");
            var appliedFamilyPath = ApplyProjectedProfile(uiApp, doc, snapshot, profile, outputDir.DirectoryPath);

            new Ballogger()
                .Add(LogEventLevel.Information, new StackFrame(),
                    $"Created snapshot profile for {snapshot.FamilyName}")
                .Show();

            if (!string.IsNullOrWhiteSpace(appliedFamilyPath))
                _ = uiApp.OpenAndActivateDocument(appliedFamilyPath);
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

        var lookupCollector = new LookupTableSectionCollector();
        if (lookupCollector.ShouldCollect(snapshot))
            lookupCollector.Collect(snapshot, famDoc);

        var refPlaneCollector = new RefPlaneSectionCollector();
        if (refPlaneCollector.ShouldCollect(snapshot))
            refPlaneCollector.Collect(snapshot, famDoc);

        var extrusionCollector = new ExtrusionSectionCollector();
        if (extrusionCollector.ShouldCollect(snapshot))
            extrusionCollector.Collect(snapshot, famDoc);

        return snapshot;
    }

    private static FFManagerSettings ProjectSnapshotToProfile(Document doc, FamilySnapshot snapshot) {
        var parameterSnapshots = snapshot.Parameters?.Data ?? [];
        var exportedParams = FamilyParamProfileAdapter.ProjectSnapshotsToProfile(parameterSnapshots);
        var authoredSolids = snapshot.ParamDrivenSolids ?? new AuthoredParamDrivenSolidsSettings();
        var compiledSolids = AuthoredParamDrivenSolidsCompiler.Compile(authoredSolids);
        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.InternalExtrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.Connectors))
            .ToList();
        var referencedSnapshotDefinitions = KnownParamPlanBuilder.BuildFamilyDefinitionsFromSnapshots(
            parameterSnapshots,
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

        return new FFManagerSettings {
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
            SetLookupTables = new SetLookupTablesSettings {
                Tables = snapshot.LookupTables?.Data?.Select(CloneLookupTable).ToList() ?? []
            },
            SetKnownParams = exportedParams.SetKnownParams,
            ParamDrivenSolids = authoredSolids
        };
    }

    private static LookupTableDefinition CloneLookupTable(LookupTableDefinition table) => new() {
        Schema = table.Schema with {
            Columns = table.Schema.Columns
                .Select(column => column with { })
                .ToList()
        },
        Rows = table.Rows
            .Select(row => row with {
                ValuesByColumn = new Dictionary<string, string>(row.ValuesByColumn, StringComparer.Ordinal)
            })
            .ToList()
    };

    private static string? ApplyProjectedProfile(
        UIApplication uiApp,
        Document sourceDoc,
        FamilySnapshot snapshot,
        FFManagerSettings profile,
        string outputDirectory
    ) {
        var targetDoc = CreateProjectedFamilyDocument(uiApp, sourceDoc, $"{snapshot.FamilyName} Snapshot");
        if (targetDoc == null)
            return null;

        try {
            var result = CmdFFManager.ProcessFamiliesCore(
                targetDoc,
                profile,
                $"{snapshot.FamilyName}-snapshot-apply",
                new LoadAndSaveOptions {
                    OpenOutputFilesOnCommandFinish = false,
                    LoadFamily = false,
                    SaveFamilyToInternalPath = false,
                    SaveFamilyToOutputDir = true
                },
                outputDirectory);

            if (!result.Success || string.IsNullOrWhiteSpace(result.OutputFolderPath))
                throw new InvalidOperationException(result.Error ?? "Projected profile apply family processing failed.");

            return GetAppliedFamilyPath(result.OutputFolderPath, targetDoc);
        } finally {
            if (targetDoc.IsValidObject)
                _ = targetDoc.Close(false);
        }
    }

    private static Document? CreateProjectedFamilyDocument(
        UIApplication uiApp,
        Document sourceDoc,
        string targetFamilyName
    ) {
        var templatePath = ResolveTargetFamilyTemplatePath(uiApp.Application, sourceDoc);
        if (string.IsNullOrWhiteSpace(templatePath) || !File.Exists(templatePath))
            return null;

        var targetDoc = uiApp.Application.NewFamilyDocument(templatePath);
        if (targetDoc == null)
            return null;

        using var transaction = new Transaction(targetDoc, "Configure projected family");
        _ = transaction.Start();
        targetDoc.OwnerFamily.Name = targetFamilyName.Trim();

        var sourceCategory = sourceDoc.OwnerFamily?.FamilyCategory;
        if (sourceCategory != null) {
            var targetCategory = Category.GetCategory(targetDoc, sourceCategory.Id);
            if (targetCategory != null)
                targetDoc.OwnerFamily.FamilyCategory = targetCategory;
        }

        _ = transaction.Commit();
        return targetDoc;
    }

    private static string? ResolveTargetFamilyTemplatePath(
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

    private static string GetAppliedFamilyPath(string outputDirectory, Document targetDoc) {
        var familyName = targetDoc.OwnerFamily?.Name;
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = Path.GetFileNameWithoutExtension(targetDoc.Title);
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
