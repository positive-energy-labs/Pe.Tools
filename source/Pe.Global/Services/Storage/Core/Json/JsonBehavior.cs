namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Defines read/write behavior for JSON files based on their semantic purpose.
/// </summary>
public enum JsonBehavior {
    /// <summary>Settings: crash if missing (force user review), strict validate/read/write with schema</summary>
    Settings,

    /// <summary>State: create default silently, full read/write with schema</summary>
    State,

    /// <summary>Output: write-only, no schema injection</summary>
    Output
}