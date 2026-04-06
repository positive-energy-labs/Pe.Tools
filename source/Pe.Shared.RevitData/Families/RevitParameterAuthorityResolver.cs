using Pe.Shared.RevitData.Parameters;

namespace Pe.Shared.RevitData.Families;

public sealed record RevitObservedProjectParameterMetadata {
    public required RevitParameterIdentity Identity { get; init; }
    public string? CategoryName { get; init; }
    public bool IsInstance { get; init; }
    public ForgeTypeId PropertiesGroup { get; init; } = new("");
    public ForgeTypeId DataType { get; init; } = new("");
}

public sealed record RevitFamilyParameterMetadata {
    public required RevitParameterIdentity Identity { get; init; }
    public bool IsInstance { get; init; }
    public ForgeTypeId PropertiesGroup { get; init; } = new("");
    public ForgeTypeId DataType { get; init; } = new("");

    public bool IsShared => this.Identity.SharedGuid.HasValue;
}

public sealed record RevitProjectBindingMetadata {
    public required RevitParameterIdentity Identity { get; init; }
    public bool IsInstance { get; init; }
    public ForgeTypeId PropertiesGroup { get; init; } = new("");
    public ForgeTypeId DataType { get; init; } = new("");
    public List<string> CategoryNames { get; init; } = [];

    public bool IsShared => this.Identity.SharedGuid.HasValue;
}

public sealed record RevitResolvedParameterMetadata {
    public required RevitParameterIdentity Identity { get; init; }
    public bool IsInstance { get; init; }
    public ForgeTypeId PropertiesGroup { get; init; } = new("");
    public ForgeTypeId DataType { get; init; } = new("");
    public bool HasFamilyParameter { get; init; }
    public bool FamilyParameterIsShared { get; init; }
    public bool HasProjectBinding { get; init; }
    public bool ProjectBindingIsShared { get; init; }
    public bool HasMergedSharedProjectBinding { get; init; }
}

public static class RevitParameterAuthorityResolver {
    public static RevitResolvedParameterMetadata Resolve(
        RevitObservedProjectParameterMetadata observed,
        RevitFamilyParameterMetadata? familyParameter,
        RevitProjectBindingMetadata? projectBinding
    ) {
        if (observed == null)
            throw new ArgumentNullException(nameof(observed));

        var hasMergedSharedProjectBinding = familyParameter is { IsShared: true } &&
                                            projectBinding is { IsShared: true } &&
                                            SameSharedGuid(familyParameter.Identity, projectBinding.Identity);
        var effectiveIdentity = ResolveIdentity(observed, familyParameter, projectBinding);
        var effectiveIsInstance = familyParameter?.IsInstance ?? projectBinding?.IsInstance ?? observed.IsInstance;
        var effectivePropertiesGroup = ResolvePropertiesGroup(observed, familyParameter, projectBinding);
        var effectiveDataType = ResolveDataType(observed, familyParameter, projectBinding);

        return new RevitResolvedParameterMetadata {
            Identity = effectiveIdentity,
            IsInstance = effectiveIsInstance,
            PropertiesGroup = effectivePropertiesGroup,
            DataType = effectiveDataType,
            HasFamilyParameter = familyParameter != null,
            FamilyParameterIsShared = familyParameter?.IsShared == true,
            HasProjectBinding = projectBinding != null,
            ProjectBindingIsShared = projectBinding?.IsShared == true,
            HasMergedSharedProjectBinding = hasMergedSharedProjectBinding
        };
    }

    public static bool MatchesFamilyParameter(
        RevitObservedProjectParameterMetadata observed,
        RevitFamilyParameterMetadata familyParameter
    ) {
        if (observed == null)
            throw new ArgumentNullException(nameof(observed));
        if (familyParameter == null)
            throw new ArgumentNullException(nameof(familyParameter));

        // Critical invariant:
        // Shared GUID is the only strong family/project match across documents.
        // Do not use ParameterElementId or built-in id here. Those identities are
        // useful within a single document pipeline, but they are not a stable
        // cross-document family-authority surface. Non-shared family matching is
        // therefore restricted to true NameFallback observations only.
        if (SameSharedGuid(observed.Identity, familyParameter.Identity))
            return true;
        if (observed.Identity.SharedGuid.HasValue || familyParameter.Identity.SharedGuid.HasValue)
            return false;
        if (observed.Identity.Kind != RevitParameterIdentityKind.NameFallback)
            return false;

        return string.Equals(observed.Identity.Name, familyParameter.Identity.Name, StringComparison.Ordinal) &&
               observed.IsInstance == familyParameter.IsInstance;
    }

    public static bool MatchesProjectSharedBinding(
        RevitObservedProjectParameterMetadata observed,
        RevitProjectBindingMetadata projectBinding
    ) {
        if (observed == null)
            throw new ArgumentNullException(nameof(observed));
        if (projectBinding == null)
            throw new ArgumentNullException(nameof(projectBinding));

        return CategoryMatches(observed.CategoryName, projectBinding) &&
               SameSharedGuid(observed.Identity, projectBinding.Identity);
    }

    public static bool MatchesProjectSharedBinding(
        string? categoryName,
        RevitFamilyParameterMetadata familyParameter,
        RevitProjectBindingMetadata projectBinding
    ) {
        if (familyParameter == null)
            throw new ArgumentNullException(nameof(familyParameter));
        if (projectBinding == null)
            throw new ArgumentNullException(nameof(projectBinding));

        return CategoryMatches(categoryName, projectBinding) &&
               SameSharedGuid(familyParameter.Identity, projectBinding.Identity);
    }

    public static bool MatchesProjectOnlyBinding(
        RevitObservedProjectParameterMetadata observed,
        RevitProjectBindingMetadata projectBinding
    ) {
        if (observed == null)
            throw new ArgumentNullException(nameof(observed));
        if (projectBinding == null)
            throw new ArgumentNullException(nameof(projectBinding));
        if (!CategoryMatches(observed.CategoryName, projectBinding))
            return false;

        // Project bindings live in the same project document as the observed
        // parameter, so ParameterElementId is safe to use here. This does not
        // imply it is safe for cross-document family matching.
        if (SameSharedGuid(observed.Identity, projectBinding.Identity))
            return observed.IsInstance == projectBinding.IsInstance;

        if (SameParameterElementId(observed.Identity, projectBinding.Identity))
            return observed.IsInstance == projectBinding.IsInstance;

        if (observed.Identity.Kind != RevitParameterIdentityKind.NameFallback ||
            projectBinding.Identity.Kind == RevitParameterIdentityKind.SharedGuid)
            return false;

        return string.Equals(observed.Identity.Name, projectBinding.Identity.Name, StringComparison.Ordinal) &&
               observed.IsInstance == projectBinding.IsInstance;
    }

    public static bool MatchesNameScopeCollision(
        RevitObservedProjectParameterMetadata observed,
        RevitProjectBindingMetadata projectBinding
    ) {
        if (observed == null)
            throw new ArgumentNullException(nameof(observed));
        if (projectBinding == null)
            throw new ArgumentNullException(nameof(projectBinding));

        return CategoryMatches(observed.CategoryName, projectBinding) &&
               string.Equals(observed.Identity.Name, projectBinding.Identity.Name, StringComparison.Ordinal) &&
               observed.IsInstance == projectBinding.IsInstance;
    }

    public static bool RepresentsSameBinding(
        RevitProjectBindingMetadata left,
        RevitProjectBindingMetadata right
    ) {
        if (left == null)
            throw new ArgumentNullException(nameof(left));
        if (right == null)
            throw new ArgumentNullException(nameof(right));

        return left.IsInstance == right.IsInstance &&
               string.Equals(left.Identity.Key, right.Identity.Key, StringComparison.Ordinal);
    }

    private static RevitParameterIdentity ResolveIdentity(
        RevitObservedProjectParameterMetadata observed,
        RevitFamilyParameterMetadata? familyParameter,
        RevitProjectBindingMetadata? projectBinding
    ) {
        if (familyParameter != null)
            return familyParameter.Identity;
        if (projectBinding != null)
            return projectBinding.Identity;

        return observed.Identity;
    }

    private static ForgeTypeId ResolvePropertiesGroup(
        RevitObservedProjectParameterMetadata observed,
        RevitFamilyParameterMetadata? familyParameter,
        RevitProjectBindingMetadata? projectBinding
    ) {
        if (familyParameter is { IsShared: true } &&
            projectBinding is { IsShared: true } &&
            SameSharedGuid(familyParameter.Identity, projectBinding.Identity))
            return projectBinding.PropertiesGroup;

        if (projectBinding != null && familyParameter == null)
            return projectBinding.PropertiesGroup;
        if (familyParameter != null)
            return familyParameter.PropertiesGroup;

        return observed.PropertiesGroup;
    }

    private static ForgeTypeId ResolveDataType(
        RevitObservedProjectParameterMetadata observed,
        RevitFamilyParameterMetadata? familyParameter,
        RevitProjectBindingMetadata? projectBinding
    ) {
        if (familyParameter is { IsShared: true } &&
            projectBinding is { IsShared: true } &&
            SameSharedGuid(familyParameter.Identity, projectBinding.Identity))
            return PreferDefinedTypeId(familyParameter.DataType, projectBinding.DataType, observed.DataType);

        if (familyParameter != null)
            return PreferDefinedTypeId(familyParameter.DataType, observed.DataType);
        if (projectBinding != null)
            return PreferDefinedTypeId(projectBinding.DataType, observed.DataType);

        return observed.DataType;
    }

    private static bool CategoryMatches(
        string? categoryName,
        RevitProjectBindingMetadata projectBinding
    ) {
        if (string.IsNullOrWhiteSpace(categoryName))
            return false;

        return projectBinding.CategoryNames.Any(bindingCategory =>
            string.Equals(bindingCategory, categoryName, StringComparison.OrdinalIgnoreCase)
        );
    }

    private static bool SameSharedGuid(
        RevitParameterIdentity left,
        RevitParameterIdentity right
    ) => left.SharedGuid.HasValue &&
         right.SharedGuid.HasValue &&
         left.SharedGuid.Value == right.SharedGuid.Value;

    private static bool SameParameterElementId(
        RevitParameterIdentity left,
        RevitParameterIdentity right
    ) => left.ParameterElementId.HasValue &&
         right.ParameterElementId.HasValue &&
         left.ParameterElementId.Value == right.ParameterElementId.Value;

    private static ForgeTypeId PreferDefinedTypeId(params ForgeTypeId[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value.TypeId)) ?? new ForgeTypeId("");
}
