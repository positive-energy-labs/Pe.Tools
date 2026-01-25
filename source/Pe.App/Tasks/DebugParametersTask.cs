using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;

namespace Pe.App.Tasks;

/// <summary>
///     Prints all parameters in the active family document to console.
///     Useful for debugging parameter setup.
/// </summary>
public sealed class DebugParametersTask : ITask {
    public string Name => "Debug Parameters";
    public string Description => "Prints all family parameters to console for debugging";
    public string Category => "Debug";

    public async Task ExecuteAsync(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null) {
            Console.WriteLine("❌ No active document");
            return;
        }

        if (!doc.IsFamilyDocument) {
            Console.WriteLine("❌ Not a family document");
            return;
        }

        var famMgr = doc.FamilyManager;
        Console.WriteLine($"\n=== Parameters ({famMgr.Parameters.Size}) ===");

        foreach (FamilyParameter param in famMgr.Parameters) {
            var formula = param.Formula;
            var isInstance = param.IsInstance ? "Instance" : "Type";
            var formulaText = string.IsNullOrEmpty(formula) ? "" : $" = {formula}";

            Console.WriteLine(
                $"  [{isInstance}] {param.Definition.Name} ({param.Definition.GetDataType()}){formulaText}");
        }

        Console.WriteLine("=== End Parameters ===\n");

        await Task.CompletedTask;
    }
}
