# Storage Service

This Service will be a simple wrapper over file read/write code within a predefined folder structure. Default behavior
will ALWAYS be encouraged (where they exist) but flexibility will also be available. Below is what the target folder
structure might look like

``` md
[assembly name]/
    ├── RevitAddin_A/
    │   ├── settings/
    │   │   ├── settings.json
    │   │   └── profiles/
    │   │       ├── Default.json
    │   │       ├── Production.json
    │   │       └── Testing.json
    │   ├── state/ 
    │   │   └── state.json
    │   ├── temp/ 
    │   │   └── temp.json
    │   └── output/
    │       ├── log_[datetime].txt
    │       └── results_[datetime].csv
    ├── RevitAddin_B/
    │   └── state/
    │       └── state.json
    └── RevitAddin_C/
        ├── settings/
        │   ├── settings.json
        │   └── profiles/
        │       └── Default.json
        └── output/
            └── error_report_[datetime].csv
```

## Purpose/Goals

The purpose of this service is to standardize the way we access local file storage in Revit addins.

- TYPE SAFETY!!!
- Fast performance.
- Generic: type of stored data will always be decided by calling context.
- Sensible defaults:
    - Only allows the predefined folders to exist.
    - Embed default file paths where applicable (i.e. `settings\` and `state\`).
    - Enforce purpose of each storage type in the API (e.g. `output\` only allows writes).
    - Standardize a minimal JSON schema for `settings\` jsons.
- Usage: minimally stateful classes, but allows...
    - dependency injection
    - consistent Fluent API
- Tight coupling: datatype of stored json and objects/classes used in code should originate from the same source of
  truth (if possible)
- [future] common helper methods for writing to output file types (csv, pdf, rvt, etc.)
- [future] common helper methods for working with persisted files (diffing, hashing, opening output file on save, etc.)
-

## Specific Expected Usage Notes

- In the top-level of a command (e.g. in `CmdCommandPalette.cs`) the storage service will be instantiated and injected
  into later stuff.

- For settings and state jsons required by WPF apps, **view models and models should use JsonSchema.Net and
  JsonSchema.Net.Generation* to make classes the source of truth for the schemas passed to the Storage service.

## Default `settings/` schema

The main settings file contains global settings and a reference to the current profile. Profile data is stored in
separate files within the `profiles/` subdirectory.

**settings.json:**

```json
{
  "OnProcessingFinish": {
    "OpenOutputFilesOnCommandFinish": true,
    "LoadFamily": true,
    "SaveFamilyToInternalPath": false,
    "SaveFamilyToOutputDir": false
  },
  "CurrentProfile": "Default"
}
```

**profiles/Default.json:**

```json
{
  "FilterFamilies": {
    "IncludeCategoriesEqualing": [],
    "IncludeNames": {
      "Equaling": [],
      "Containing": [],
      "StartingWith": []
    },
    "ExcludeNames": {
      "Equaling": [],
      "Containing": [],
      "StartingWith": []
    }
  },
  "FilterApsParams": {
    "IncludeNames": {
      "Equaling": [],
      "Containing": [],
      "StartingWith": []
    },
    "ExcludeNames": {
      "Equaling": [],
      "Containing": [],
      "StartingWith": []
    }
  }
}
```

### Profile Management

- Each profile is stored as a separate JSON file in `settings/profiles/{ProfileName}.json`
- The `CurrentProfile` property in `settings.json` determines which profile is active
- Profiles are loaded on-demand when accessed via `GetProfile(settingsManager)`
- This structure enables easy version control, sharing, and management of individual profiles



