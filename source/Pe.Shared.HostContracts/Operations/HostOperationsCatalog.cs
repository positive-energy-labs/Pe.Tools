using System.Linq;
using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class HostOperationsCatalog {
    public static IReadOnlyList<HostOperationDefinition> All { get; } = Validate(BridgeOpCatalog.Definitions);

    public static IReadOnlyList<HostOperationDefinition> Bridge { get; } = BridgeOpCatalog.Definitions;

    private static IReadOnlyList<HostOperationDefinition> Validate(
        IReadOnlyList<HostOperationDefinition> definitions
    ) {
        var duplicateKeys = definitions
            .GroupBy(definition => definition.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateKeys.Count != 0)
            throw new InvalidOperationException(
                $"Duplicate host operation keys: {string.Join(", ", duplicateKeys)}"
            );

        var incompleteDefinitions = definitions
            .Where(definition =>
                string.IsNullOrWhiteSpace(definition.Key)
                || definition.RequestType == null
                || definition.ResponseType == null
            )
            .Select(definition => definition.Key)
            .ToList();
        if (incompleteDefinitions.Count != 0)
            throw new InvalidOperationException(
                $"Incomplete host operation definitions: {string.Join(", ", incompleteDefinitions)}"
            );

        ValidateAgentMetadata(definitions);

        return definitions;
    }

    private static void ValidateAgentMetadata(IReadOnlyList<HostOperationDefinition> definitions) {
        var errors = new List<string>();

        foreach (var definition in definitions) {
            var metadata = definition.AgentMetadata;

            if (metadata.CallGuidance.Count > 2)
                errors.Add($"{definition.Key}: CallGuidance has {metadata.CallGuidance.Count} entries; max 2.");
            if (metadata.RequestExamples.Count > 2)
                errors.Add($"{definition.Key}: RequestExamples has {metadata.RequestExamples.Count} entries; max 2.");

            if (!definition.IsPublic)
                continue;

            var dotIndex = definition.Key.IndexOf(".", StringComparison.Ordinal);
            var topLevel = dotIndex < 0 ? definition.Key : definition.Key[..dotIndex];
            if (topLevel is "rvt" or "rfa" or "rvtrfa")
                errors.Add($"{definition.Key}: document kind must be metadata, not a top-level route family.");

            if (definition.Key.StartsWith("revit.", StringComparison.Ordinal) && !IsValidPublicRevitKey(definition.Key))
                errors.Add($"{definition.Key}: Revit public keys must follow revit.<layer>.<noun>[.<variant>].");
        }

        if (errors.Count != 0)
            throw new InvalidOperationException($"Invalid host operation metadata:{Environment.NewLine}  {string.Join($"{Environment.NewLine}  ", errors)}");
    }

    private static bool IsValidPublicRevitKey(string key) {
        var parts = key.Split('.');
        if (parts.Length is < 3 or > 4)
            return false;
        if (!string.Equals(parts[0], "revit", StringComparison.Ordinal))
            return false;
        return parts[1] is "context" or "catalog" or "matrix" or "detail" or "resolve" or "apply"
            && !string.IsNullOrWhiteSpace(parts[2])
            && (parts.Length == 3 || !string.IsNullOrWhiteSpace(parts[3]));
    }
}
