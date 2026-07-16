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
            static (_, _, _) => RunInRevitAsync(CaptureActiveFamily)
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
            static (request, _, _) => RunInRevitAsync(() => BuildFamily(request))
        );

    private static FamilyModelCaptureData CaptureActiveFamily() {
        var document = RevitUiSession.CurrentUIApplication.ActiveUIDocument?.Document
                       ?? throw new InvalidOperationException("No active Revit document.");
        if (!document.IsFamilyDocument)
            throw new InvalidOperationException("The active Revit document is not a family document.");

        var model = document.CaptureFamilyModel();
        return new FamilyModelCaptureData(
            model.Family.Name,
            JsonConvert.SerializeObject(model, Formatting.Indented),
            model.Unmodeled.Count);
    }

    private static FamilyModelBuildData BuildFamily(FamilyModelBuildRequest request) {
        var outputPath = Path.GetFullPath(request.OutputPath);
        if (!string.Equals(Path.GetExtension(outputPath), ".rfa", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("OutputPath must end in .rfa.", nameof(request));
        if (File.Exists(outputPath) && !request.Overwrite)
            throw new IOException($"Output family already exists: '{outputPath}'. Set overwrite=true to replace it.");

        var parsed = FamilyModelJson.Parse(request.ModelJson);
        if (parsed.Value == null || parsed.Diagnostics.Count != 0)
            throw new ArgumentException(string.Join(Environment.NewLine,
                parsed.Diagnostics.Select(item => $"{item.Path}: {item.Message}")), nameof(request));

        var modelDirectory = string.IsNullOrWhiteSpace(request.ModelDirectory)
            ? null
            : Path.GetFullPath(request.ModelDirectory);
        var result = FamilyModelBuilder.Build(
            RevitUiSession.CurrentUIApplication.Application,
            parsed.Value,
            modelDirectory);
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            result.Document.SaveAs(outputPath, new SaveAsOptions {
                OverwriteExistingFile = request.Overwrite,
                Compact = true,
                MaximumBackups = 1
            });
            return new FamilyModelBuildData(parsed.Value.Family.Name, outputPath, result.TemplatePath);
        } finally {
            _ = result.Document.Close(false);
        }
    }

    private static async Task<T> RunInRevitAsync<T>(Func<T> action) {
        var run = RevitTaskAccessor.RunAsync
                  ?? throw new InvalidOperationException("The Revit task queue is not configured.");
        var result = default(T);
        await run(() => result = action());
        return result!;
    }
}
