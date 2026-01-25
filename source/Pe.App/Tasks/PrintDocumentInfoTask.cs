using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;

namespace Pe.App.Tasks;

/// <summary>
///     Prints detailed information about the active document.
/// </summary>
public sealed class PrintDocumentInfoTask : ITask {
    static PrintDocumentInfoTask() => TaskRegistry.Instance.Register(new PrintDocumentInfoTask());

    public static void Register() { }

    public string Name => "Print Document Info";
    public string Description => "Prints detailed information about the active document";
    public string Category => "Debug";

    public async Task ExecuteAsync(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null) {
            Console.WriteLine("❌ No active document");
            return;
        }

        Console.WriteLine("\n=== Document Info ===");
        Console.WriteLine($"  Title: {doc.Title}");
        Console.WriteLine($"  Path: {doc.PathName}");
        Console.WriteLine($"  Is Family: {doc.IsFamilyDocument}");
        Console.WriteLine($"  Is Modified: {doc.IsModified}");
        Console.WriteLine($"  Is Workshared: {doc.IsWorkshared}");

        if (doc.IsFamilyDocument) {
            var fm = doc.FamilyManager;
            Console.WriteLine($"  Current Type: {fm.CurrentType?.Name ?? "None"}");
            Console.WriteLine($"  Family Category: {doc.OwnerFamily?.FamilyCategory?.Name ?? "None"}");
        }

        Console.WriteLine("=== End Document Info ===\n");

        await Task.CompletedTask;
    }
}
