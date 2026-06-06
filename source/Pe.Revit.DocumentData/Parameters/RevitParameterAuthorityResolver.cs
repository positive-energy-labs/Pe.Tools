namespace Pe.Revit.DocumentData.Parameters;

public sealed record RevitObservedProjectParameterMetadata : RevitParameterDefinition {
    public string? CategoryName { get; init; }
}

public sealed record RevitFamilyParameterMetadata : RevitParameterDefinition;

public sealed record RevitProjectBindingMetadata : RevitParameterDefinition {
    public List<string> CategoryNames { get; init; } = [];
}

public sealed record RevitResolvedParameterMetadata : RevitParameterDefinition {
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
            Definition = RevitParameterDefinition.Descriptor(
                effectiveIdentity,
                effectiveDataType,
                effectivePropertiesGroup,
                effectiveIsInstance),
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

        if (SameSharedGuid(observed.Identity, familyParameter.Identity))
            return true;
        if (!string.IsNullOrWhiteSpace(observed.Identity.SharedGuid) ||
            !string.IsNullOrWhiteSpace(familyParameter.Identity.SharedGuid))
            return false;
        if (observed.Identity.Kind != ParameterIdentityKind.NameFallback)
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

        if (SameSharedGuid(observed.Identity, projectBinding.Identity))
            return observed.IsInstance == projectBinding.IsInstance;

        if (SameParameterElementId(observed.Identity, projectBinding.Identity))
            return observed.IsInstance == projectBinding.IsInstance;

        if (observed.Identity.Kind != ParameterIdentityKind.NameFallback ||
            projectBinding.Identity.Kind == ParameterIdentityKind.SharedGuid)
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

    private static ParameterIdentity ResolveIdentity(
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
        ParameterIdentity left,
        ParameterIdentity right
    ) => !string.IsNullOrWhiteSpace(left.SharedGuid) &&
         !string.IsNullOrWhiteSpace(right.SharedGuid) &&
         string.Equals(left.SharedGuid, right.SharedGuid, StringComparison.OrdinalIgnoreCase);

    private static bool SameParameterElementId(
        ParameterIdentity left,
        ParameterIdentity right
    ) => left.ParameterElementId.HasValue &&
         right.ParameterElementId.HasValue &&
         left.ParameterElementId.Value == right.ParameterElementId.Value;

    private static ForgeTypeId PreferDefinedTypeId(params ForgeTypeId[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value.TypeId)) ?? new ForgeTypeId("");

}
