using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;
using System.IO;

namespace Pe.App.Host;

internal static class FamilyModelBridgeOps {
    public static readonly BridgeOp Capture =
        BridgeOp.Create<FamilyModelCaptureRequest, FamilyModelCaptureData>(
            "family.model.capture",
            "Capture Family Model",
            HostOperationAgentMetadata.Create(
                "Capture the active Revit family document as portable family.json authored truth, including explicit unmodeled diagnostics.",
                ["family-model", "family-json", "capture", "roundtrip", "family-foundry"],
                requiresActiveDocument: true
            ),
            static (_, _, ct) => PaletteThreading.RunRevitAsync(CaptureActiveFamily, ct)
        );

    public static readonly BridgeOp Build =
        BridgeOp.Create<FamilyModelBuildRequest, FamilyModelBuildData>(
            "family.model.build",
            "Build Family Model",
            HostOperationAgentMetadata.Create(
                "Build a new target-year Revit family from portable family.json and save it to an explicit .rfa output path.",
                ["family-model", "family-json", "build", "replay", "family-foundry", "manager"],
                HostOperationIntent.Mutate,
                requiresActiveDocument: false,
                costTier: HostOperationCostTier.Mutation
            ),
            static (request, _, ct) => PaletteThreading.RunRevitAsync(() => BuildFamily(request), ct)
        );

    private static FamilyModelCaptureData CaptureActiveFamily() {
        var document = RevitUiSession.CurrentUIApplication.ActiveUIDocument?.Document
                       ?? throw BridgeOperationExceptions.Conflict("No active Revit document.");
        if (!document.IsFamilyDocument)
            throw BridgeOperationExceptions.Conflict("The active Revit document is not a family document.");

        var model = document.CaptureFamilyModel();
        return new FamilyModelCaptureData(
            model.Family.Name,
            JsonConvert.SerializeObject(model, Formatting.Indented),
            model.Unmodeled.Count);
    }

    private static FamilyModelBuildData BuildFamily(FamilyModelBuildRequest request) {
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
        var result = FamilyModelBuilder.BuildAndSave(
            RevitUiSession.CurrentUIApplication.Application,
            parsed.Value,
            outputPath,
            modelDirectory,
            request.Overwrite);
        return new FamilyModelBuildData(parsed.Value.Family.Name, outputPath, result.TemplatePath);
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
