using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;
using System.IO;

namespace Pe.App.Host;

internal static class FamilyModelBridgeOps {
    public static readonly BridgeOp Capture = FamilyModelHostOperations.Capture(
        static (_, _, ct) => PaletteThreading.RunRevitAsync(CaptureActiveFamily, ct));

    public static readonly BridgeOp Build = FamilyModelHostOperations.Build(
        static (request, _, ct) => PaletteThreading.RunRevitAsync(() => BuildFamily(request), ct));

    private static FamilyModelCaptureData CaptureActiveFamily() {
        var document = RevitUiSession.CurrentUIApplication.ActiveUIDocument?.Document
                       ?? throw BridgeOperationExceptions.Conflict("No active Revit document.");
        if (!document.IsFamilyDocument)
            throw BridgeOperationExceptions.Conflict("The active Revit document is not a family document.");

        var model = document.CaptureFamilyModel();
        var evidence = FamilyModelEvidenceProjector.Project(
            model,
            FamilySnapshotExtractor.ExtractFromFamilyDocument(document));
        return new FamilyModelCaptureData(
            model.Family.Name,
            JsonConvert.SerializeObject(model, Formatting.Indented),
            model.Unmodeled.Count,
            evidence);
    }

    private static FamilyModelBuildData BuildFamily(FamilyModelBuildRequest request) {
        if (string.IsNullOrWhiteSpace(request.ModelJson))
            throw BridgeOperationExceptions.BadRequest("ModelJson is required.");

        var outputPath = ResolvePath(request.OutputPath, nameof(request.OutputPath));
        if (!string.Equals(Path.GetExtension(outputPath), ".rfa", StringComparison.OrdinalIgnoreCase))
            throw BridgeOperationExceptions.BadRequest("OutputPath must end in .rfa.");
        if (File.Exists(outputPath) && !request.Overwrite)
            throw BridgeOperationExceptions.Conflict(
                $"Output family already exists: '{outputPath}'. Set overwrite=true to replace it.");

        var parsed = FamilyModelJson.Parse(request.ModelJson);
        if (parsed.Value == null || parsed.Diagnostics.Count != 0)
            throw BridgeOperationExceptions.BadRequest(string.Join(Environment.NewLine,
                parsed.Diagnostics.Select(item => $"{item.Path}: {item.Message}")));

        var modelDirectory = string.IsNullOrWhiteSpace(request.ModelDirectory)
            ? null
            : ResolvePath(request.ModelDirectory, nameof(request.ModelDirectory));
        FamilyModelSaveResult result;
        try {
            result = FamilyModelBuilder.BuildAndSave(
                RevitUiSession.CurrentUIApplication.Application,
                parsed.Value,
                outputPath,
                modelDirectory,
                request.Overwrite);
        } catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or
                                            FileNotFoundException or DirectoryNotFoundException) {
            throw BridgeOperationExceptions.BadRequest(exception.Message);
        }
        var evidence = FamilyModelEvidenceProjector.Project(parsed.Value, result.Snapshot);
        return new FamilyModelBuildData(parsed.Value.Family.Name, outputPath, result.TemplatePath, evidence);
    }

    private static string ResolvePath(string? path, string field) {
        if (string.IsNullOrWhiteSpace(path))
            throw BridgeOperationExceptions.BadRequest($"{field} is required.");

        try {
            return Path.GetFullPath(path);
        } catch (Exception exception) when (exception is ArgumentException or NotSupportedException or
                                            PathTooLongException) {
            throw BridgeOperationExceptions.BadRequest($"{field} is invalid: {exception.Message}");
        }
    }

}
