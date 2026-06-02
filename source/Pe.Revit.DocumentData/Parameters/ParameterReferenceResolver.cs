using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Parameters;

public sealed record ResolvedParameterReference(
    ParameterIdentity Identity,
    string? Name,
    string? SharedGuid,
    int? BuiltInParameterId,
    long? ParameterElementId
) {
    public bool HasLookupSignal =>
        !string.IsNullOrWhiteSpace(this.Name)
        || !string.IsNullOrWhiteSpace(this.SharedGuid)
        || this.BuiltInParameterId.HasValue
        || this.ParameterElementId.HasValue;
}

public static class ParameterReferenceResolver {
    public static IReadOnlyList<ResolvedParameterReference> Resolve(IEnumerable<ParameterReference>? references) =>
        (references ?? [])
        .Select(ResolveOne)
        .Where(reference => reference is { HasLookupSignal: true })
        .Cast<ResolvedParameterReference>()
        .GroupBy(reference => reference.Identity.Key, StringComparer.OrdinalIgnoreCase)
        .Select(group => group.First())
        .ToList();

    public static bool Matches(ParameterIdentity identity, IReadOnlyCollection<ResolvedParameterReference> references) {
        if (references.Count == 0)
            return true;

        return references.Any(reference => Matches(identity, reference));
    }

    public static bool Matches(ParameterIdentity identity, ResolvedParameterReference reference) {
        if (!string.IsNullOrWhiteSpace(reference.Identity.Key) &&
            string.Equals(identity.Key, reference.Identity.Key, StringComparison.OrdinalIgnoreCase))
            return true;

        if (!string.IsNullOrWhiteSpace(reference.SharedGuid) &&
            string.Equals(identity.SharedGuid, reference.SharedGuid, StringComparison.OrdinalIgnoreCase))
            return true;

        if (reference.BuiltInParameterId.HasValue && identity.BuiltInParameterId == reference.BuiltInParameterId)
            return true;

        if (reference.ParameterElementId.HasValue && identity.ParameterElementId == reference.ParameterElementId)
            return true;

        return !string.IsNullOrWhiteSpace(reference.Name) &&
               string.Equals(identity.Name, reference.Name, StringComparison.OrdinalIgnoreCase);
    }

    private static ResolvedParameterReference? ResolveOne(ParameterReference reference) {
        var identity = reference.Identity == null
            ? CreateIdentity(reference.Name, reference.SharedGuid)
            : ParameterIdentityEngine.FromCanonical(reference.Identity);
        var name = FirstNonBlank(reference.Name) ??
                   (identity.Kind == ParameterIdentityKind.NameFallback ? identity.Name : null);
        var sharedGuid = FirstValidSharedGuid(reference.SharedGuid, identity.SharedGuid);

        return new ResolvedParameterReference(
            identity,
            name,
            sharedGuid,
            identity.BuiltInParameterId,
            identity.ParameterElementId);
    }

    private static ParameterIdentity CreateIdentity(string? name, string? sharedGuid) {
        var normalizedName = string.IsNullOrWhiteSpace(name) ? sharedGuid ?? string.Empty : name.Trim();
        return ParameterIdentityEngine.FromRaw(
            normalizedName,
            null,
            FirstValidSharedGuid(sharedGuid, null),
            null);
    }

    private static string? FirstNonBlank(params string?[] values) => values
        .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
        ?.Trim();

    private static string? FirstValidSharedGuid(params string?[] values) {
        foreach (var value in values) {
            if (Guid.TryParse(value, out var guid))
                return guid.ToString("D");
        }

        return null;
    }
}
