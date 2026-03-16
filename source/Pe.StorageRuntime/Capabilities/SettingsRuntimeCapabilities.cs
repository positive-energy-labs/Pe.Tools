namespace Pe.StorageRuntime.Capabilities;

public enum SettingsCapabilityTier {
    RevitAssembly = 0,
    LiveRevitDocument = 1
}

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct)]
public sealed class SettingsCapabilityTierAttribute(SettingsCapabilityTier tier) : Attribute {
    public SettingsCapabilityTier Tier { get; } = tier;
}

public static class SettingsCapabilityResolver {
    public static SettingsCapabilityTier GetRequiredTier(Type type) =>
        type.GetCustomAttributes(typeof(SettingsCapabilityTierAttribute), true)
            .OfType<SettingsCapabilityTierAttribute>()
            .Select(attribute => attribute.Tier)
            .DefaultIfEmpty(SettingsCapabilityTier.RevitAssembly)
            .Max();

    public static bool IsSupported(Type type, SettingsCapabilityTier availableTier) =>
        GetRequiredTier(type) <= availableTier;
}
