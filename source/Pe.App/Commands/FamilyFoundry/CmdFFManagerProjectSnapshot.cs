using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Revit.Global.Revit.Documents;
using Pe.Revit.Global.Revit.Ui;
using Pe.Revit.Global.Services.Aps.Models;
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

            var snapshot = doc.CaptureFamilySnapshot();

            var projection = ProjectSnapshotToProfiles(snapshot);
            var denseProfile = projection.DenseProfile;
            var emptyAllowedProfile = projection.EmptyAllowedProfile;
            var outputDir = storage.Output().TimestampedSubDir();
            var denseProfileName = $"{snapshot.FamilyName}-snapshot-dense.json";
            var emptyAllowedProfileName = $"{snapshot.FamilyName}-snapshot-empty-allowed.json";
            var denseOutputPath = outputDir.Json(denseProfileName).Write(denseProfile);
            var emptyAllowedOutputPath = outputDir.Json(emptyAllowedProfileName).Write(emptyAllowedProfile);
            Pe.Revit.FamilyFoundry.LookupTables.LookupTableArtifactWriter.WriteCsvFiles(
                denseProfile.SetLookupTables.Tables,
                outputDir.DirectoryPath,
                "lookup-tables");
            var appliedFamilyPath = ApplyProjectedProfile(uiApp, doc, snapshot, denseProfile, outputDir.DirectoryPath);

            new Ballogger()
                .Add(LogEventLevel.Information, new StackFrame(),
                    $"Created snapshot profiles for {snapshot.FamilyName}\nDense: {denseOutputPath}\nEmptyAllowed: {emptyAllowedOutputPath}\nOutput: {outputDir.DirectoryPath}")
                .Show();

            if (!string.IsNullOrWhiteSpace(appliedFamilyPath))
                _ = uiApp.OpenAndActivateDocument(appliedFamilyPath);
            else if (emptyAllowedOutputPath != null)
                FileUtils.OpenInDefaultApp(emptyAllowedOutputPath);

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private static FamilySnapshotProfileProjection ProjectSnapshotToProfiles(FamilySnapshot snapshot) {
        var sharedParameterNames = ResolveCachedSharedParameterNames();
        return FamilySnapshotProfileProjector.ProjectProfiles(
            snapshot,
            snapshot.FamilyName,
            name => sharedParameterNames.Contains(name));
    }

    private static HashSet<string> ResolveCachedSharedParameterNames() {
        var cache = RuntimeStorageClient.Default.Global().State().Json<ParametersApi.Parameters>("parameters-service-cache").Read();
        return cache.Results?
                   .Where(parameter => !parameter.IsArchived)
                   .Select(parameter => parameter.Name?.Trim())
                   .Where(name => !string.IsNullOrWhiteSpace(name))
                   .Select(name => name!)
                   .ToHashSet(StringComparer.Ordinal)
               ?? [];
    }

    private static string? ApplyProjectedProfile(
        UIApplication uiApp,
        Document sourceDoc,
        FamilySnapshot snapshot,
        FFManagerProfile profile,
        string outputDirectory
    ) {
        var targetDoc = CreateProjectedFamilyDocument(uiApp, sourceDoc, $"{snapshot.FamilyName} Snapshot");
        if (targetDoc == null)
            return null;

        try {
            var result = targetDoc.ApplyFamilyProfile(
                profile,
                $"{snapshot.FamilyName}-snapshot-apply",
                new LoadAndSaveOptions {
                    OpenOutputFilesOnCommandFinish = false,
                    LoadFamily = false,
                    SaveFamilyToInternalPath = false,
                    SaveFamilyToOutputDir = true
                },
                OutputStorage.ExactDir(outputDirectory));

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
        var familyFileStem = targetDoc.GetFamilyFileStem();
        return Path.Combine(outputDirectory, familyFileStem, $"{familyFileStem}.rfa");
    }
}
