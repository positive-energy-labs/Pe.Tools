using Autodesk.Revit.DB;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.Operations;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;
using System.IO;

namespace Pe.App.Host;

internal static class FamilyModelBridgeOps {
    [Op("revit.detail.family-model", Does = "Capture the active Revit family document as portable family.json, with per-section coverage and the unmodeled ledger.", Title = "Capture Family Model", Finds = ["family-model", "family-json", "capture", "roundtrip", "family-foundry"], Cost = OpCost.Bounded)]
    private static Task<FamilyModelCaptureData> Capture(FamilyModelCaptureRequest _, FamilyDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => CaptureActiveFamily(document.Value), cancellationToken);

    [Op("revit.apply.family-model", Does = "Build a Revit family from portable family.json by reconciling a fresh template document, save it to an explicit .rfa path, and report the receipt residue.", Title = "Build Family Model", Finds = ["family-model", "family-json", "build", "reconcile", "family-foundry"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static Task<FamilyModelBuildData> Build(FamilyModelBuildRequest request, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => BuildFamily(request), cancellationToken);

    private static FamilyModelCaptureData CaptureActiveFamily(Document document) {
        var model = document.CaptureFamilyModel();
        return new FamilyModelCaptureData(
            DocumentReading.Here(document),
            model.Family.Name,
            FamilyModelJson.Serialize(model),
            model.Unmodeled.Count,
            model.Coverage.ToDictionary(p => p.Key, p => p.Value.ToString()));
    }

    private static FamilyModelBuildData BuildFamily(FamilyModelBuildRequest request) {
        if (string.IsNullOrWhiteSpace(request.ModelJson))
            throw BridgeOperationExceptions.BadRequest("ModelJson is required.");
        var outputPath = ResolvePath(request.OutputPath, nameof(request.OutputPath));
        if (!string.Equals(Path.GetExtension(outputPath), ".rfa", StringComparison.OrdinalIgnoreCase))
            throw BridgeOperationExceptions.BadRequest("OutputPath must end in .rfa.");
        if (File.Exists(outputPath) && !request.Overwrite)
            throw BridgeOperationExceptions.Conflict($"Output family already exists: '{outputPath}'. Set overwrite=true to replace it.");

        var parsed = FamilyModelJson.Parse(request.ModelJson);
        if (parsed.Value == null || parsed.Diagnostics.Count != 0)
            throw BridgeOperationExceptions.BadRequest(string.Join(Environment.NewLine, parsed.Diagnostics.Select(item => $"{item.Path}: {item.Message}")));

        try {
            var (receipt, templatePath, reading) = FamilyModelBuild.BuildAndSave(RevitUiSession.CurrentUIApplication.Application, parsed.Value, outputPath, request.Overwrite);
            return new FamilyModelBuildData(reading, parsed.Value.Family.Name, outputPath, templatePath,
                receipt?.Converged ?? false, receipt?.Residue.Count ?? 0);
        } catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or FileNotFoundException or DirectoryNotFoundException) {
            throw BridgeOperationExceptions.BadRequest(exception.Message);
        }
    }

    private static string ResolvePath(string? path, string field) {
        if (string.IsNullOrWhiteSpace(path)) throw BridgeOperationExceptions.BadRequest($"{field} is required.");
        try { return Path.GetFullPath(path); }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException) {
            throw BridgeOperationExceptions.BadRequest($"{field} is invalid: {exception.Message}");
        }
    }
}
