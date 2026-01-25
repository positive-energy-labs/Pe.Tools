---
name: ""
overview: ""
todos: []
isProject: false
---

# Task Palette System - Implementation Plan

## Overview

A simple, extensible system for registering and executing arbitrary code
snippets/tasks through a palette UI. Designed for rapid prototyping, testing,
and one-off operations with future support for user-defined C# files.

## Architecture Goals

### Current Phase: Built-in Tasks

- Single-file task definitions in dedicated folder
- Singleton registry pattern for task collection
- Palette UI for browsing and executing tasks
- Type-safe task metadata

### Future Phase: User-Extensible Tasks

- Load arbitrary C# files from user's local filesystem
- Roslyn compilation at runtime
- Hot-reload support for rapid iteration
- Sandbox/security considerations
- Task validation and error handling

## File Structure

```
source/Pe.App/
  Commands/
    Palette/
      CmdPltTasks.cs              # IExternalCommand + palette creation
      TaskPalette/
        TaskRegistry.cs           # Singleton registry for all tasks
        TaskItem.cs               # IPaletteListItem implementation
        ITask.cs                  # Core task interface
  Tasks/                          # NEW: Task definitions folder
    ExampleTask.cs                # Example: Simple task
    DebugParametersTask.cs        # Example: Print all parameters
    ClearWarningsTask.cs          # Example: Clear all warnings
    [UserTasks...]                # Future: User-defined tasks
```

## Core Interfaces & Types

### `ITask` Interface

The fundamental contract for all tasks (built-in and future user-defined):

```csharp
/// <summary>
/// Represents an executable task that can be run from the Task Palette.
/// Designed for prototyping, testing, and one-off operations.
/// </summary>
public interface ITask {
    /// <summary>
    /// Unique identifier for this task (used for persistence, debugging)
    /// Convention: PascalCase, descriptive (e.g., "DebugParameters", "ClearWarnings")
    /// </summary>
    string Id { get; }
    
    /// <summary>
    /// Display name shown in the palette
    /// </summary>
    string Name { get; }
    
    /// <summary>
    /// Optional description for tooltip/preview panel (future enhancement)
    /// </summary>
    string Description { get; }
    
    /// <summary>
    /// Optional category for grouping tasks (future enhancement: filtering)
    /// Examples: "Debug", "Testing", "Cleanup", "Export"
    /// </summary>
    string Category { get; }
    
    /// <summary>
    /// Executes the task. Called within Revit API context.
    /// </summary>
    /// <param name="uiApp">UIApplication for accessing Revit API</param>
    /// <returns>Task representing async operation</returns>
    Task ExecuteAsync(UIApplication uiApp);
}
```

### `TaskItem` Class

Palette list item implementation:

```csharp
/// <summary>
/// Wraps an ITask for display in the Task Palette.
/// Tracks usage statistics for smart ordering.
/// </summary>
public class TaskItem : IPaletteListItem {
    public ITask Task { get; init; }
    public int UsageCount { get; set; }
    public DateTime LastUsed { get; set; }
    
    // IPaletteListItem implementation
    public string TextPrimary => Task.Name;
    public string TextSecondary => Task.Category;
    public string TextPill => null; // No shortcuts for tasks
    public Func<string> GetTextInfo => () => Task.Description;
    public BitmapImage Icon => null; // Future: custom icons per task
    public Color? ItemColor => null; // Future: category-based colors
}
```

### `TaskRegistry` Singleton

Central registry for all tasks:

```csharp
/// <summary>
/// Singleton registry for all executable tasks.
/// Handles task registration, persistence, and retrieval.
/// </summary>
public sealed class TaskRegistry {
    private static readonly Lazy<TaskRegistry> _instance = new(() => new TaskRegistry());
    public static TaskRegistry Instance => _instance.Value;
    
    private readonly Dictionary<string, ITask> _tasks = new();
    private readonly object _lock = new();
    
    private TaskRegistry() { }
    
    /// <summary>
    /// Registers a task. Called from task file constructors via static registration.
    /// Thread-safe for future extensibility (user-defined tasks loaded in parallel).
    /// </summary>
    public void Register(ITask task) {
        lock (_lock) {
            if (_tasks.ContainsKey(task.Id)) {
                throw new InvalidOperationException(
                    $"Task '{task.Id}' is already registered. Task IDs must be unique.");
            }
            _tasks[task.Id] = task;
        }
    }
    
    /// <summary>
    /// Gets all registered tasks.
    /// </summary>
    public IReadOnlyList<ITask> GetAll() {
        lock (_lock) {
            return _tasks.Values.ToList();
        }
    }
    
    /// <summary>
    /// Gets a task by ID (for future: direct execution via command line, etc.)
    /// </summary>
    public ITask? GetById(string id) {
        lock (_lock) {
            return _tasks.GetValueOrDefault(id);
        }
    }
    
    /// <summary>
    /// FUTURE: Loads user-defined tasks from C# files on disk.
    /// Will use Roslyn to compile and instantiate ITask implementations.
    /// </summary>
    public void LoadUserTasks(string tasksDirectory) {
        // Phase 2 implementation:
        // 1. Scan directory for *.cs files
        // 2. Use Roslyn to compile each file
        // 3. Reflect to find ITask implementations
        // 4. Instantiate and register
        // 5. Handle errors gracefully (compilation failures, invalid tasks, etc.)
        throw new NotImplementedException("User-defined tasks not yet supported");
    }
    
    /// <summary>
    /// FUTURE: Unregisters a task (for hot-reload scenarios)
    /// </summary>
    public void Unregister(string taskId) {
        lock (_lock) {
            _tasks.Remove(taskId);
        }
    }
}
```

## Task Definition Pattern

### Single-File Task Definition

Each task is a single file in `Tasks/` folder with static registration:

```csharp
namespace Pe.App.Tasks;

/// <summary>
/// Example task: Prints all parameters in the active document to console.
/// Useful for debugging parameter setup.
/// </summary>
public sealed class DebugParametersTask : ITask {
    // Static registration - runs when class is first referenced
    static DebugParametersTask() {
        TaskRegistry.Instance.Register(new DebugParametersTask());
    }
    
    // Force static constructor to run (called from assembly initialization)
    public static void Register() { }
    
    public string Id => "DebugParameters";
    public string Name => "Debug Parameters";
    public string Description => "Prints all family parameters to console for debugging";
    public string Category => "Debug";
    
    public async Task ExecuteAsync(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null) {
            Console.WriteLine("No active document");
            return;
        }
        
        if (!doc.IsFamilyDocument) {
            Console.WriteLine("Not a family document");
            return;
        }
        
        var famMgr = doc.FamilyManager;
        Console.WriteLine($"=== Parameters ({famMgr.Parameters.Size}) ===");
        
        foreach (FamilyParameter param in famMgr.Parameters) {
            Console.WriteLine($"  {param.Definition.Name} ({param.Definition.ParameterType})");
        }
        
        await Task.CompletedTask;
    }
}
```

### Assembly Initialization

Ensure all tasks are registered at startup:

```csharp
// In Pe.App/Tasks/TaskInitializer.cs
namespace Pe.App.Tasks;

/// <summary>
/// Forces all task static constructors to run, registering tasks with the registry.
/// Called during application startup.
/// </summary>
internal static class TaskInitializer {
    public static void RegisterAllTasks() {
        // Calling Register() on each task class forces static constructor to run
        DebugParametersTask.Register();
        ClearWarningsTask.Register();
        ExampleTask.Register();
        // Add new tasks here...
        
        // FUTURE: Use reflection to auto-discover all ITask implementations
        // This removes the need to manually list each task
    }
}
```

## Palette Implementation

### `CmdPltTasks.cs`

Command to open the Task Palette:

```csharp
namespace Pe.App.Commands.Palette;

[Transaction(TransactionMode.Manual)]
public class CmdPltTasks : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        try {
            var uiapp = commandData.Application;
            var persistence = new Storage(nameof(CmdPltTasks));
            
            var palette = TaskPaletteService.Create(uiapp, persistence);
            palette.Show();
            
            return Result.Succeeded;
        } catch (Exception ex) {
            throw new InvalidOperationException($"Error opening task palette: {ex.Message}");
        }
    }
}

public static class TaskPaletteService {
    public static EphemeralWindow Create(UIApplication uiApp, Storage persistence) {
        // Load all registered tasks
        var tasks = TaskRegistry.Instance.GetAll();
        
        // Load usage statistics from persistence
        var usageStats = persistence.Read<Dictionary<string, (int count, DateTime lastUsed)>>(
            "TaskUsageStats") ?? new();
        
        // Create TaskItems with usage data
        var taskItems = tasks.Select(task => {
            var (count, lastUsed) = usageStats.GetValueOrDefault(
                task.Id, (0, DateTime.MinValue));
            
            return new TaskItem {
                Task = task,
                UsageCount = count,
                LastUsed = lastUsed
            };
        }).ToList();
        
        // Create search service (search by name and category)
        var searchConfig = SearchConfig.PrimaryAndSecondary();
        var searchService = new SearchFilterService<TaskItem>(
            persistence,
            item => item.Task.Id,
            searchConfig);
        
        // Single action: Execute
        var actions = new List<PaletteAction<TaskItem>> {
            new() {
                Name = "Execute",
                Execute = async item => {
                    try {
                        await item.Task.ExecuteAsync(uiApp);
                        
                        // Update usage statistics
                        item.UsageCount++;
                        item.LastUsed = DateTime.Now;
                        
                        usageStats[item.Task.Id] = (item.UsageCount, item.LastUsed);
                        persistence.Write("TaskUsageStats", usageStats);
                        
                        Console.WriteLine($"✓ Task '{item.Task.Name}' completed");
                    } catch (Exception ex) {
                        Console.WriteLine($"✗ Task '{item.Task.Name}' failed: {ex.Message}");
                        Console.WriteLine(ex.StackTrace);
                    }
                },
                CanExecute = _ => true
            }
        };
        
        // Create view model
        var viewModel = new PaletteViewModel<TaskItem>(taskItems, searchService);
        
        // Create palette
        var palette = new Ui.Components.Palette();
        palette.Initialize(viewModel, actions);
        
        // Wrap in window
        var window = new EphemeralWindow(palette, "Task Palette");
        palette.SetParentWindow(window);
        return window;
    }
}
```

## Button Registration

Add button to ribbon (in `ButtonRegistry.cs`):

```csharp
// In ButtonRegistry registration list:
Register<CmdPltTasks>(new() {
    Text = "Tasks",
    SmallImage = "baseline_code_white_18dp.png",
    LargeImage = "baseline_code_white_24dp.png",
    ToolTip = "Task Palette - Execute custom code snippets",
    LongDescription = "Open a palette of executable tasks for prototyping, testing, and one-off operations",
    Container = new ButtonContainer.Panel("PE Palettes")
});
```

## Example Tasks

### 1. Debug Parameters Task (shown above)

### 2. Clear Warnings Task

```csharp
public sealed class ClearWarningsTask : ITask {
    static ClearWarningsTask() {
        TaskRegistry.Instance.Register(new ClearWarningsTask());
    }
    
    public static void Register() { }
    
    public string Id => "ClearWarnings";
    public string Name => "Clear All Warnings";
    public string Description => "Deletes all warning swallower elements";
    public string Category => "Cleanup";
    
    public async Task ExecuteAsync(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null) return;
        
        // Implementation...
        await Task.CompletedTask;
    }
}
```

### 3. Export Parameter CSV Task

```csharp
public sealed class ExportParameterCsvTask : ITask {
    static ExportParameterCsvTask() {
        TaskRegistry.Instance.Register(new ExportParameterCsvTask());
    }
    
    public static void Register() { }
    
    public string Id => "ExportParameterCsv";
    public string Name => "Export Parameters to CSV";
    public string Description => "Exports all family parameters to a CSV file on the desktop";
    public string Category => "Export";
    
    public async Task ExecuteAsync(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc?.IsFamilyDocument != true) {
            Console.WriteLine("Not a family document");
            return;
        }
        
        var desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
        var csvPath = Path.Combine(desktopPath, $"{doc.Title}_parameters.csv");
        
        // Implementation: write CSV...
        Console.WriteLine($"✓ Exported to: {csvPath}");
        await Task.CompletedTask;
    }
}
```

## Future Enhancements

### Phase 2: User-Defined Tasks

#### Task File Template

Provide users with a template C# file:

```csharp
// MyCustomTask.cs
// Place this file in: C:\Users\{username}\Documents\PeTools\Tasks\

using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;

public class MyCustomTask : ITask {
    public string Id => "MyCustomTask";
    public string Name => "My Custom Task";
    public string Description => "Does something custom";
    public string Category => "Custom";
    
    public async Task ExecuteAsync(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        
        // Your code here...
        
        await Task.CompletedTask;
    }
}
```

#### Loading User Tasks

```csharp
// In TaskRegistry.LoadUserTasks():
public void LoadUserTasks(string tasksDirectory) {
    if (!Directory.Exists(tasksDirectory)) return;
    
    var csFiles = Directory.GetFiles(tasksDirectory, "*.cs", SearchOption.AllDirectories);
    
    foreach (var file in csFiles) {
        try {
            // 1. Read file content
            var source = File.ReadAllText(file);
            
            // 2. Compile with Roslyn
            var compilation = CSharpCompilation.Create(
                Path.GetFileNameWithoutExtension(file),
                new[] { CSharpSyntaxTree.ParseText(source) },
                references: GetReferences(), // Revit API, Pe.App, etc.
                options: new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary)
            );
            
            // 3. Emit to memory
            using var ms = new MemoryStream();
            var result = compilation.Emit(ms);
            
            if (!result.Success) {
                Console.WriteLine($"Failed to compile {file}:");
                foreach (var diag in result.Diagnostics)
                    Console.WriteLine($"  {diag}");
                continue;
            }
            
            // 4. Load assembly and find ITask implementations
            ms.Seek(0, SeekOrigin.Begin);
            var assembly = Assembly.Load(ms.ToArray());
            
            var taskTypes = assembly.GetTypes()
                .Where(t => typeof(ITask).IsAssignableFrom(t) && !t.IsInterface && !t.IsAbstract);
            
            // 5. Instantiate and register
            foreach (var taskType in taskTypes) {
                var task = (ITask)Activator.CreateInstance(taskType);
                Register(task);
                Console.WriteLine($"✓ Loaded user task: {task.Name}");
            }
        } catch (Exception ex) {
            Console.WriteLine($"Error loading task from {file}: {ex.Message}");
        }
    }
}
```

#### Settings Integration

```csharp
// Add to app settings:
public class TaskPaletteSettings {
    /// <summary>
    /// Directory containing user-defined task C# files.
    /// Default: C:\Users\{username}\Documents\PeTools\Tasks\
    /// </summary>
    public string UserTasksDirectory { get; set; } = 
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "PeTools", "Tasks"
        );
    
    /// <summary>
    /// Whether to auto-load user tasks on startup
    /// </summary>
    public bool AutoLoadUserTasks { get; set; } = true;
    
    /// <summary>
    /// Whether to watch for changes and hot-reload tasks
    /// </summary>
    public bool EnableHotReload { get; set; } = true;
}
```

### Phase 3: Advanced Features

1. **Hot Reload**: FileSystemWatcher to detect changes and recompile
2. **Task Parameters**: Allow tasks to define input parameters (prompt user via
   UI)
3. **Task Dependencies**: Tasks can depend on other tasks (execution pipeline)
4. **Task Scheduling**: Run tasks on timer/events (e.g., before save)
5. **Task Debugging**: Attach debugger to user-defined tasks
6. **Task Marketplace**: Share tasks with community (GitHub repo of task files)
7. **Task Categories as Tabs**: Palette with tabs per category
8. **Task Preview Panel**: Show task source code in sidebar on selection

## Benefits

### Current Phase

- **Rapid Prototyping**: Write task → register → execute (no ribbon/command
  overhead)
- **Type Safety**: ITask interface ensures consistent structure
- **Persistence**: Usage tracking for smart ordering
- **Discoverability**: All tasks in one palette
- **Minimal Boilerplate**: Single file per task

### Future Phase

- **User Extensibility**: Anyone can write tasks without modifying Pe.Tools
- **Iteration Speed**: Edit C# file → save → auto-reload → execute
- **No Build Required**: Roslyn compiles at runtime
- **Sharing**: Tasks as files (easy to distribute via GitHub, Discord, etc.)
- **Learning**: Users can inspect existing tasks to learn Revit API

## Implementation Checklist

- [ ] Create `ITask` interface in `Pe.App/Commands/Palette/TaskPalette/`
- [ ] Create `TaskItem` class (IPaletteListItem implementation)
- [ ] Create `TaskRegistry` singleton
- [ ] Create `TaskInitializer` static class
- [ ] Create `Tasks/` folder in `Pe.App/`
- [ ] Implement 3 example tasks (Debug, Clear, Export)
- [ ] Create `CmdPltTasks.cs` command
- [ ] Create `TaskPaletteService` factory
- [ ] Register button in `ButtonRegistry.cs`
- [ ] Add task registration call in `StartupCommand.cs`
- [ ] Test: Open palette → select task → execute → verify
- [ ] Document: Add usage guide to README

## Future Work Checklist (Phase 2+)

- [ ] Add Roslyn NuGet packages to Pe.App.csproj
- [ ] Implement `TaskRegistry.LoadUserTasks()`
- [ ] Create task file template and documentation
- [ ] Add settings for user tasks directory
- [ ] Implement hot-reload with FileSystemWatcher
- [ ] Add error handling UI for compilation failures
- [ ] Create task debugging guide
- [ ] Build example task library (GitHub repo)

## Notes

- **Keep it Simple**: Phase 1 should be <1 hour of work (core plumbing only)
- **Future-Proof**: Architecture supports user tasks without breaking changes
- **DX First**: Minimize friction for adding new tasks
- **Type Safety**: Compile-time checks where possible, runtime for user tasks
- **Fail Fast**: Clear error messages for common issues (missing doc, wrong doc
  type, etc.)
