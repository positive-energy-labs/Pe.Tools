using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;

namespace Pe.App.Tasks;

/// <summary>
///     Example task demonstrating the basic structure.
///     Replace with your own task implementation.
/// </summary>
public sealed class ExampleTask : ITask {
    public string Name => "Example Task";
    public string Description => "A simple example task that prints a message";
    public string Category => "Examples";

    public async Task ExecuteAsync(UIApplication uiApp) {
        Console.WriteLine("✓ Example task executed!");

        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc != null)
            Console.WriteLine($"  Active document: {doc.Title}");
        else
            Console.WriteLine("  No active document");

        await Task.CompletedTask;
    }
}
