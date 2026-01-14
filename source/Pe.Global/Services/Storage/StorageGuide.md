# Storage Service Guide

## Overview

The Storage Service provides type-safe, standardized file storage for Revit
addins. It enforces a consistent folder structure and provides generic wrappers
for JSON and CSV operations with automatic schema validation.

**Base Path**: `MyDocuments\Pe.App\{addinName}\`

## API

### Initialization

```csharp
var storage = new Storage("FF Manager");
```

### Storage Managers

**Settings Manager** - Read-only configuration

```csharp
var settingsManager = storage.Settings();
var settings = settingsManager.Json<MySettings>().Read();
var profile = settingsManager.Subdirectory("profiles").Json<MyProfile>($"{settings.CurrentProfile}.json").Read();
```

**State Manager** - Read/write stateful data

```csharp
var stateManager = storage.State();
// JSON: Full read/write
var state = stateManager.Json<MyState>().Read();
stateManager.Json<MyState>().Write(state);
// CSV: Granular row operations
var csv = stateManager.Csv<CommandUsageData>();
csv.WriteRow("key", data);
var row = csv.ReadRow("key");
var all = csv.Read();
```

**Output Manager** - Write-only user-facing results

```csharp
var outputManager = storage.Output();
// Extension is automatically added if not present
outputManager.Json("results").Write(results);           // Creates results.json
outputManager.Json("results.json").Write(results);      // Also creates results.json
outputManager.Csv("log.csv").Write(logData);
var path = outputManager.DirectoryPath; // Get folder path to pass to other methods
```

**Global Manager** - Static global storage shared across all addins

```csharp
Storage.Global().SettingsFile().Read(); // Global settings (APS credentials, etc.)
Storage.Global().StateJsonFile<T>("cache").Read(); // Global state files
Storage.Global().Log("Error message"); // Append to global log
```

## Type Safety Features

- **Generic operations**: All methods use `Json<T>()` and `Csv<T>()` where
  `T : class, new()`
- **Schema generation**: Automatically creates `.schema.json` files from class
  properties
- **Validation**: Reads/writes validate against schema with helpful error
  messages
- **Auto-recovery**: Invalid JSON files are fixed and re-saved with default
  values
- **CSV dictionary model**: First column is key, remaining columns map to
  properties

## File Structure Example

Based on the CmdFF commands (FF Manager, FF Migrator), the Storage service
creates the following structure:

```txt
MyDocuments\Pe.App\
├── Global\
│   ├── settings.json              # Global APS credentials
│   ├── settings.schema.json
│   └── log.txt                    # Auto-cleaned global log (max 500 lines)
│
├── FF Manager\
│   ├── settings\
│   │   ├── settings.json          # CurrentProfile + OnProcessingFinish options
│   │   ├── settings.schema.json
│   │   └── profiles\
│   │       ├── Default.json       # Profile-specific configuration
│   │       ├── Default.schema.json
│   │       ├── Production.json
│   │       └── Testing.json
│   ├── state\
│   │   ├── state.json             # Stateful data (optional)
│   │   └── state.csv              # Row-based state (optional)
│   └── output\
│       ├── 2025-11-05_143022.json # Timestamped output files
│       └── 2025-11-05_143022.csv
│
├── FF Migrator\
│   ├── settings\
│   │   ├── settings.json
│   │   ├── settings.schema.json
│   │   └── profiles\
│   │       └── Default.json
│   ├── state\
│   │   └── state.json
│   └── output\
│       └── migration_results.csv
│
└── Cmd Palette\
    └── state\
        └── state.csv              # Command usage tracking (key = CommandId)
```

### Directory Breakdown

**Global/** - Shared across all addins

- `settings.json`: APS credentials, account IDs, group IDs
- `log.txt`: Append-only log with auto-cleanup

**{addinName}/settings/** - Configuration that persists between sessions

- Main `settings.json`: Global options + `CurrentProfile` reference
- `profiles/{Name}.json`: Profile-specific settings
- Read-only access enforced by API

**{addinName}/state/** - Frequently updated data

- `state.json` or `state.csv`: Choose based on access pattern
- CSV supports granular row updates (e.g., command usage tracking)
- Full read/write access

**{addinName}/output/** - User-facing results

- No default filename (always specify)
- Write-only access enforced by API
- Typically timestamped files: `{datetime}.json`, `{datetime}.csv`

## Common Patterns

### Pattern 1: Settings + Profile + Output

```csharp
var storage = new Storage("FF Manager");
var settings = storage.Settings().Json<BaseSettings<ProfileFamilyManager>>().Read();
var profile = storage.Settings().Subdirectory("profiles")
    .Json<ProfileFamilyManager>($"{settings.CurrentProfile}.json").Read();
var outputPath = storage.Output().DirectoryPath;
```

### Pattern 2: CSV State Tracking

```csharp
var storage = new Storage("Cmd Palette");
var csv = storage.State().Csv<CommandUsageData>();
// Update usage on command execution
csv.WriteRow(commandId, new CommandUsageData { 
    CommandId = commandId, 
    Score = score + 1, 
    LastUsed = DateTime.Now 
});
```

### Pattern 3: Global + Local

```csharp
// Load global APS settings once
var globalSettings = Storage.Global().SettingsFile().Read();
var apsClientId = globalSettings.ApsDesktopClientId1;

// Use local addin storage
var storage = new Storage("FF Manager");
var outputPath = storage.Output().DirectoryPath;
```
