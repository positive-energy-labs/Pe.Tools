namespace Pe.Ui.Core;

/// <summary>
///     Record representing item usage data for storage
/// </summary>
public record ItemUsageData {
    public string ItemKey { get; init; } = string.Empty;
    public int UsageCount { get; init; }
    public DateTime LastUsed { get; init; }
}