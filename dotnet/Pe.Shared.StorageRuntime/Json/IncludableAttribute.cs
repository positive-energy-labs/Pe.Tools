namespace Pe.Shared.StorageRuntime.Json;

public enum IncludableFragmentRoot {
    FamilyNames,
    SharedParameterNames,
    MappingData,
    StressMappingData,
    Fields,
    TestItems
}

public static class IncludableFragmentRoots {
    public static string ToSchemaName(IncludableFragmentRoot root) => root switch {
        IncludableFragmentRoot.FamilyNames => "family-names",
        IncludableFragmentRoot.SharedParameterNames => "shared-parameter-names",
        IncludableFragmentRoot.MappingData => "mapping-data",
        IncludableFragmentRoot.StressMappingData => "stress-mapping-data",
        IncludableFragmentRoot.Fields => "fields",
        IncludableFragmentRoot.TestItems => "test-items",
        _ => throw new ArgumentOutOfRangeException(nameof(root), root, "Unsupported includable fragment root.")
    };

    public static string NormalizeRoot(string rawRoot) {
        var normalized = rawRoot.Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
            throw new InvalidOperationException("Includable fragment root cannot be empty.");
        if (normalized.Contains('/') || normalized == "." || normalized == "..")
            throw new InvalidOperationException($"Invalid includable fragment root '{rawRoot}'.");
        return normalized.StartsWith("_", StringComparison.Ordinal) ? normalized : "_" + normalized;
    }

    public static string ToNormalizedRoot(IncludableFragmentRoot root) =>
        NormalizeRoot(ToSchemaName(root));
}

[AttributeUsage(AttributeTargets.Property)]
public class IncludableAttribute : Attribute {
    public IncludableAttribute(IncludableFragmentRoot fragmentRoot)
        : this(IncludableFragmentRoots.ToSchemaName(fragmentRoot)) {
    }

    public IncludableAttribute(string? fragmentSchemaName = null) => this.FragmentSchemaName = fragmentSchemaName;

    public string? FragmentSchemaName { get; }
}