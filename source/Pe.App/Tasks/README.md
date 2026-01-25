# Task Palette - Task Definitions

This folder contains executable task definitions for the Task Palette system.

## What is a Task?

A task is a simple, executable code snippet designed for:

- **Rapid prototyping** - Test new features without creating full commands
- **Debugging** - Inspect document state, parameters, elements, etc.
- **One-off operations** - Cleanup scripts, exports, data collection
- **Testing** - Experiment with Revit API behavior

## Creating a New Task

### 1. Create a new `.cs` file in this folder

```csharp
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;

namespace Pe.App.Tasks;

/// <summary>
///     Brief description of what this task does.
/// </summary>
public sealed class MyNewTask : ITask {
    // Static registration - ensures task is registered when class loads
    static MyNewTask() {
        TaskRegistry.Instance.Register(new MyNewTask());
    }
    
    // Force static constructor to run (called from TaskInitializer)
    public static void Register() { }
    
    public string Name => "My Task Name";
    public string? Description => "Detailed description shown in tooltip";
    public string? Category => "MyCategory"; // Used for filtering
    
    public async Task ExecuteAsync(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null) {
            Console.WriteLine("❌ No active document");
            return;
        }
        
        // Your code here...
        Console.WriteLine("✓ Task completed!");
        
        await Task.CompletedTask;
    }
}
```

### 2. Register the task in `TaskInitializer.cs`

```csharp
public static void RegisterAllTasks() {
    DebugParametersTask.Register();
    ExampleTask.Register();
    MyNewTask.Register(); // ← Add your new task here
    // ...
}
```

### 3. Build and test

The task will appear in the Task Palette, organized by category.

## Task Properties

### `Name` (required)

Display name shown in the palette. Keep it concise and descriptive.

### `Description` (optional)

Detailed description shown in tooltips. Explain what the task does and any
requirements.

### `Category` (optional)

Used for:

- Grouping related tasks
- Filtering in the palette (shown as text pill)
- Organizing large collections of tasks

Common categories: `Debug`, `Testing`, `Export`, `Cleanup`, `Analysis`

### `ExecuteAsync` (required)

The actual task implementation. Always runs in Revit API context with access to
`UIApplication`.

## Task Output Management

Tasks that generate output files should use the output management system for
consistent organization:

```csharp
public async Task ExecuteAsync(UIApplication uiApp) {
    // Get task-specific output directory
    var output = this.GetOutput();
    
    // Write JSON file
    var jsonPath = output.Json("mydata.json").Write(myData);
    
    // Write CSV file with timestamp
    var csvPath = output.CsvDated("results").Write(myCsvData);
    
    // Get directory path for custom file types
    var customPath = Path.Combine(output.DirectoryPath, "custom.txt");
    File.WriteAllText(customPath, "Hello World");
    
    Console.WriteLine($"✓ Output saved to: {output.DirectoryPath}");
}
```

Output files are saved to:
`Documents/Pe.App/CmdPltTasks/output/{TaskClassName}/`

For example, `ExportApsParametersTask` outputs go to:
`Documents/Pe.App/CmdPltTasks/output/ExportApsParametersTask/`

## Best Practices

### ✅ Do

- **Keep tasks simple and focused** - One task = one job
- **Check for null documents** - Not all commands work without an active
  document
- **Validate document type** - Check `IsFamilyDocument` if working with families
- **Use Console.WriteLine** - Output helpful messages for debugging
- **Handle errors gracefully** - Wrap risky operations in try-catch
- **Use descriptive names** - `DebugParameters` not `Task1`

### ❌ Don't

- **Create transactions in tasks** - Keep tasks read-only unless necessary
- **Duplicate task class names** - ID is derived from class name (must be
  unique)
- **Forget to register** - Always add to `TaskInitializer.cs`
- **Leave test code** - Clean up experimental tasks or move to separate category

## Example Tasks

### Debug Task

```csharp
public string? Category => "Debug";

public async Task ExecuteAsync(UIApplication uiApp) {
    var doc = uiApp.ActiveUIDocument?.Document;
    if (doc?.IsFamilyDocument != true) {
        Console.WriteLine("❌ Not a family document");
        return;
    }
    
    foreach (FamilyParameter param in doc.FamilyManager.Parameters) {
        Console.WriteLine($"  {param.Definition.Name}");
    }
    
    await Task.CompletedTask;
}
```

### Export Task

```csharp
public string? Category => "Export";

public async Task ExecuteAsync(UIApplication uiApp) {
    var doc = uiApp.ActiveUIDocument?.Document;
    if (doc == null) return;
    
    // Use task output management
    var output = this.GetOutput();
    
    var csv = GenerateCsvData(doc);
    var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
    var filename = $"export_{timestamp}.csv";
    var path = Path.Combine(output.DirectoryPath, filename);
    
    File.WriteAllText(path, csv);
    Console.WriteLine($"✓ Exported to: {path}");
    
    await Task.CompletedTask;
}
```

## Task Usage Tracking

The Task Palette automatically tracks:

- **Usage count** - How many times each task has been executed
- **Last used** - When each task was last executed

This data is used to intelligently sort tasks, showing frequently-used tasks
first.

## Future: User-Defined Tasks

In a future version, users will be able to:

- Place `.cs` files in a local directory (e.g., `Documents/PeTools/Tasks/`)
- Have tasks automatically compiled and loaded at runtime (via Roslyn)
- Share tasks as files without modifying Pe.Tools source
- Hot-reload tasks during development

The current architecture is designed to support this seamlessly.
