# Family Foundry Operation Guide

## Operation Types

### DocOperation

Use for **document-level** operations (runs once per family).

```csharp
public class MyDocOp : DocOperation<MySettings> {
    public MyDocOp(MySettings settings) : base(settings) { }
    public override string Description => "What this does";
    
    public override OperationLog Execute(FamilyDocument doc) {
        var logs = new List<LogEntry>();
        // Your logic here - executes once for the entire family
        return new OperationLog(this.Name, logs);
    }
}
```

### TypeOperation

Use for **type-level** operations (runs once per family type, e.g.,
reading/writing type parameter values).

```csharp
public class MyTypeOp : TypeOperation<MySettings> {
    public MyTypeOp(MySettings settings) : base(settings) { }
    public override string Description => "What this does";
    
    public override OperationLog Execute(FamilyDocument doc) {
        var logs = new List<LogEntry>();
        // Your logic here - executes for each family type
        // FamilyManager.CurrentType is already set by the framework
        return new OperationLog(this.Name, logs);
    }
}
```

## Settings

```csharp
public class MySettings : IOperationSettings {
    public bool Enabled { get; init; } = true;
    // Add your properties here
}
```

## Logging

LogEntry uses semantic methods for clear state tracking:

```csharp
// Success
logs.Add(new LogEntry("ParameterName").Success("Action description"));

// Skip (intentionally not processed)
logs.Add(new LogEntry("ParameterName").Skip("Reason for skipping"));

// Error
logs.Add(new LogEntry("ParameterName").Error(ex));
// or with custom message
logs.Add(new LogEntry("ParameterName").Error("Custom error message"));

// Defer (partial work, next operation will complete)
log.Defer("Partial action");  // Use in operation groups
```

### LogEntry Status

- `Pending` - Not yet processed
- `Success` - Successfully completed
- `Skipped` - Intentionally not processed
- `Error` - Failed with error

Check status with `log.IsComplete` (true for Success/Skipped/Error).

## Minimal Sandbox Test

```csharp
// 1. Hardcode settings
var settings = new MySettings { Enabled = true };

// 2. Create operation
var operation = new MyDocOp(settings);

// 3. Create queue and processor
var queue = new OperationQueue().Add(operation);
var processor = new OperationProcessor<BaseProfileSettings>(
    doc,
    _ => new List<Family>(),
    _ => new List<(ExternalDefinition, ForgeTypeId, bool)>(),
    new ExecutionOptions { SingleTransaction = true }
);

// 4. Execute
var (results, totalMs) = processor.ProcessQueue(
    queue,
    @"C:\Temp\Output",
    new TestLoadAndSaveOptions()
);

// 5. Print results
foreach (var context in results) {
    var (logs, _) = context.OperationLogs;
    if (logs == null) continue;
    foreach (var log in logs) {
        Console.WriteLine($"{log.OperationName}: {log.SuccessCount} success, {log.SkippedCount} skipped, {log.ErrorCount} errors");
        foreach (var entry in log.Entries) {
            var status = entry.Status switch {
                LogStatus.Success => "✓",
                LogStatus.Skipped => "○",
                LogStatus.Error => "✗",
                _ => "?"
            };
            Console.WriteLine($"  {status} {entry.Name} {entry.Message}");
        }
    }
}

processor.Dispose();

// Helper class
class TestLoadAndSaveOptions : ILoadAndSaveOptions {
    public bool LoadFamily { get; set; } = false;
    public bool SaveFamilyToInternalPath { get; set; } = false;
    public bool SaveFamilyToOutputDir { get; set; } = true;
}
```

## Complete Example

```csharp
using AddinFamilyFoundrySuite.Core;

namespace AddinFamilyFoundrySuite.Core.Operations;

public class DeleteUnusedParams : DocOperation<DeleteUnusedParamsSettings> {
    public DeleteUnusedParams(DeleteUnusedParamsSettings settings) : base(settings) { }
    
    public override string Description => "Delete unused parameters";
    
    public override OperationLog Execute(FamilyDocument doc) {
        var logs = new List<LogEntry>();
        var parameters = doc.FamilyManager.Parameters
            .OfType<FamilyParameter>()
            .Where(p => !ParameterUtils.IsBuiltInParameter(p.Id))
            .ToList();
        
        foreach (var param in parameters) {
            var paramName = param.Definition.Name;
            try {
                if (!param.AssociatedParameters.Cast<Parameter>().Any()) {
                    doc.FamilyManager.RemoveParameter(param);
                    logs.Add(new LogEntry(paramName).Success("Deleted"));
                }
            } catch (Exception ex) {
                logs.Add(new LogEntry(paramName).Error(ex));
            }
        }
        
        return new OperationLog(this.Name, logs);
    }
}

public class DeleteUnusedParamsSettings : IOperationSettings {
    public bool Enabled { get; init; } = true;
}
```
