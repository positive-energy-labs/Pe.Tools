using Pe.Global.Revit.Lib.Families.LoadedFamilies.Models;

namespace Pe.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

internal static class LoadedFamiliesParameterClassifier {
    public static ClassificationResult Resolve(
        bool hasFamilyParameter,
        bool familyParameterIsShared,
        bool hasProjectBinding,
        bool projectBindingIsShared,
        bool hasMergedProjectBinding
    ) {
        if (hasFamilyParameter) {
            return new ClassificationResult(
                familyParameterIsShared
                    ? CollectedParameterKind.SharedParameter
                    : CollectedParameterKind.FamilyParameter,
                familyParameterIsShared && hasMergedProjectBinding
                    ? CollectedParameterScope.FamilyAndProjectBinding
                    : CollectedParameterScope.Family,
                null
            );
        }

        if (hasProjectBinding) {
            return new ClassificationResult(
                projectBindingIsShared
                    ? CollectedParameterKind.ProjectSharedParameter
                    : CollectedParameterKind.ProjectParameter,
                CollectedParameterScope.ProjectBindingOnly,
                null
            );
        }

        return new ClassificationResult(
            CollectedParameterKind.Unknown,
            CollectedParameterScope.Unresolved,
            CollectedExcludedParameterReason.UnresolvedClassification
        );
    }

    internal readonly record struct ClassificationResult(
        CollectedParameterKind Kind,
        CollectedParameterScope Scope,
        CollectedExcludedParameterReason? ExcludedReason
    );
}