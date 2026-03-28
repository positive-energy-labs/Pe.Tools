using Pe.Global.Revit.Lib.Families.LoadedFamilies.Models;
using Pe.Global.Services.Document;
using Pe.RevitData.Families;
using Pe.RevitData.Parameters;
using System.Diagnostics;

namespace Pe.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

public static class LoadedFamiliesFormulaCollector {
    public static List<CollectedLoadedFamilyRecord> Supplement(
        Document projectDocument,
        IReadOnlyList<CollectedLoadedFamilyRecord> families,
        Action<string, TimeSpan>? onFamilySupplemented = null
    ) {
        var projectBindingLookup = BuildProjectBindingLookup(projectDocument, families);
        return families
            .Select(family => {
                var stopwatch = Stopwatch.StartNew();
                var supplementedFamily = SupplementFamily(projectDocument, family, projectBindingLookup);
                onFamilySupplemented?.Invoke(supplementedFamily.FamilyName, stopwatch.Elapsed);
                return supplementedFamily;
            })
            .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static CollectedLoadedFamilyRecord SupplementFamily(
        Document projectDocument,
        CollectedLoadedFamilyRecord family,
        List<RevitProjectBindingMetadata> projectBindingLookup
    ) {
        if (family.Parameters.Count == 0)
            return family;

        var issues = family.Issues.ToList();
        var familyElement = projectDocument.GetElement(new ElementId(checked((int)family.FamilyId))) as Family;
        if (familyElement == null) {
            issues.Add(new CollectedIssue(
                "FamilyNotFound",
                CollectedIssueSeverity.Error,
                $"Family with id '{family.FamilyId}' was not found in the active project.",
                family.FamilyName
            ));
            return family with { Issues = issues };
        }

        Document? familyDocument = null;
        var shouldClose = false;

        try {
            var existingFamilyDocument = DocumentManager.FindOpenFamilyDocument(familyElement);
            familyDocument = existingFamilyDocument ?? projectDocument.EditFamily(familyElement);
            shouldClose = existingFamilyDocument == null;

            var parameterLookup = BuildFamilyParameterLookup(familyDocument, family.FamilyName, issues);
            var supplementedParameters = family.Parameters
                .Select(parameter => SupplementParameterFormula(
                    parameter,
                    parameterLookup,
                    projectBindingLookup,
                    family.FamilyName,
                    issues
                ))
                .ToList();
            return family with { Parameters = supplementedParameters, Issues = issues };
        } catch (Exception ex) {
            issues.Add(new CollectedIssue(
                "FamilyFormulaCollectionFailed",
                CollectedIssueSeverity.Error,
                ex.Message,
                family.FamilyName
            ));
            return family with { Issues = issues };
        } finally {
            if (shouldClose && familyDocument != null) {
                try {
                    _ = familyDocument.Close(false);
                } catch {
                    // Best effort only. The route must not fail because a temp family doc could not close.
                }
            }
        }
    }

    private static FamilyParameterLookup BuildFamilyParameterLookup(
        Document familyDocument,
        string familyName,
        List<CollectedIssue> issues
    ) {
        var sharedByGuid = new Dictionary<Guid, FamilyParameterLookupEntry>();
        var byNameAndScope = new Dictionary<string, FamilyParameterLookupEntry>(StringComparer.Ordinal);

        foreach (var familyParameter in familyDocument.FamilyManager.GetParameters().ToList()) {
            var entry = TryCreateFamilyParameterEntry(familyParameter, familyName, issues);
            if (entry == null)
                continue;

            var key = LoadedFamiliesCollectorSupport.GetParameterKey(
                entry.Metadata.Identity.Name,
                entry.Metadata.IsInstance
            );
            if (byNameAndScope.ContainsKey(key)) {
                issues.Add(new CollectedIssue(
                    "FamilyParameterLookupCollision",
                    CollectedIssueSeverity.Warning,
                    $"Family parameter key '{key}' is duplicated in family document '{familyName}'.",
                    familyName,
                    null,
                    entry.Metadata.Identity.Name
                ));
            } else {
                byNameAndScope[key] = entry;
            }

            if (!entry.Metadata.Identity.SharedGuid.HasValue)
                continue;

            var sharedGuid = entry.Metadata.Identity.SharedGuid.Value;
            if (sharedByGuid.ContainsKey(sharedGuid)) {
                issues.Add(new CollectedIssue(
                    "FamilySharedParameterGuidCollision",
                    CollectedIssueSeverity.Warning,
                    $"Shared parameter GUID '{sharedGuid:D}' is duplicated in family document '{familyName}'.",
                    familyName,
                    null,
                    entry.Metadata.Identity.Name
                ));
                continue;
            }

            sharedByGuid[sharedGuid] = entry;
        }

        return new FamilyParameterLookup(sharedByGuid, byNameAndScope);
    }

    private static FamilyParameterLookupEntry? TryCreateFamilyParameterEntry(
        FamilyParameter familyParameter,
        string familyName,
        List<CollectedIssue> issues
    ) {
        try {
            var identity = RevitParameterIdentityFactory.FromFamilyParameter(familyParameter);
            return new FamilyParameterLookupEntry(
                new RevitFamilyParameterMetadata {
                    Identity = identity,
                    IsInstance = familyParameter.IsInstance,
                    PropertiesGroup = familyParameter.Definition.GetGroupTypeId(),
                    DataType = familyParameter.Definition.GetDataType()
                },
                familyParameter
            );
        } catch (Exception ex) {
            issues.Add(new CollectedIssue(
                "FamilyParameterMetadataReadFailed",
                CollectedIssueSeverity.Warning,
                ex.Message,
                familyName,
                null,
                familyParameter.Definition?.Name
            ));
            return null;
        }
    }

    private static CollectedFamilyParameterRecord SupplementParameterFormula(
        CollectedFamilyParameterRecord parameter,
        FamilyParameterLookup familyParameterLookup,
        List<RevitProjectBindingMetadata> projectBindingLookup,
        string familyName,
        List<CollectedIssue> issues
    ) {
        var observed = CreateObservedProjectParameterMetadata(parameter);
        var familyLookupObserved = CreateFamilyLookupObservedProjectParameterMetadata(observed);
        // Resolution order is intentional:
        // 1. Let a concrete project binding claim the observed row first.
        // 2. Only if no project binding matches do we allow non-shared
        //    family name/scope fallback.
        // This prevents PP/FP same-name collisions from being reclassified as
        // family-owned while still allowing true family-only observations.
        var projectObservedBinding = FindProjectOnlyBinding(observed, projectBindingLookup);
        var familyParameter = FindFamilyParameter(
            parameter,
            familyLookupObserved,
            familyParameterLookup,
            allowNameScopeFallback: projectObservedBinding == null
        );
        var mergedProjectBinding = familyParameter?.Metadata.IsShared == true
            ? FindMergedProjectBinding(parameter.CategoryName, familyParameter.Metadata, projectBindingLookup)
            : null;
        var effectiveProjectBinding = mergedProjectBinding ?? projectObservedBinding;
        var resolved = RevitParameterAuthorityResolver.Resolve(
            observed,
            familyParameter?.Metadata,
            effectiveProjectBinding
        );
        var classifiedParameter = ApplyResolvedMetadata(parameter, resolved);
        var classification = LoadedFamiliesParameterClassifier.Resolve(
            resolved.HasFamilyParameter,
            resolved.FamilyParameterIsShared,
            resolved.HasProjectBinding,
            resolved.ProjectBindingIsShared,
            resolved.HasMergedSharedProjectBinding
        );
        classifiedParameter = classifiedParameter with {
            Kind = classification.Kind,
            Scope = classification.Scope,
            ExcludedReason = classification.ExcludedReason
        };

        if (familyParameter != null) {
            ReportProjectBindingNameCollision(
                observed,
                familyParameter.Metadata,
                projectBindingLookup,
                mergedProjectBinding,
                familyName,
                issues
            );

            return ApplyFamilyFormula(classifiedParameter, familyParameter.Parameter, familyName, issues);
        }

        if (effectiveProjectBinding != null) {
            return classifiedParameter with {
                FormulaState = CollectedFormulaState.NotApplicable,
                Formula = null
            };
        }

        if (parameter.IsBuiltIn) {
            return classifiedParameter with {
                Kind = CollectedParameterKind.Unknown,
                Scope = CollectedParameterScope.Unresolved,
                FormulaState = CollectedFormulaState.NotApplicable,
                Formula = null,
                ExcludedReason = CollectedExcludedParameterReason.ProjectObservedBuiltIn
            };
        }

        issues.Add(new CollectedIssue(
            "FamilyParameterFormulaLookupMiss",
            CollectedIssueSeverity.Warning,
            $"Could not resolve parameter authority for '{parameter.Name}'.",
            familyName,
            null,
            parameter.Name
        ));
        return classifiedParameter with {
            Kind = CollectedParameterKind.Unknown,
            Scope = CollectedParameterScope.Unresolved,
            FormulaState = CollectedFormulaState.Unknown,
            Formula = null,
            ExcludedReason = CollectedExcludedParameterReason.UnresolvedClassification
        };
    }

    private static CollectedFamilyParameterRecord ApplyFamilyFormula(
        CollectedFamilyParameterRecord parameter,
        FamilyParameter familyParameter,
        string familyName,
        List<CollectedIssue> issues
    ) {
        try {
            var formula = string.IsNullOrWhiteSpace(familyParameter.Formula) ? null : familyParameter.Formula;
            return parameter with {
                FormulaState = formula == null ? CollectedFormulaState.None : CollectedFormulaState.Present,
                Formula = formula
            };
        } catch (Exception ex) {
            issues.Add(new CollectedIssue(
                "FamilyParameterFormulaReadFailed",
                CollectedIssueSeverity.Warning,
                ex.Message,
                familyName,
                null,
                parameter.Name
            ));
            return parameter with {
                FormulaState = CollectedFormulaState.Unknown,
                Formula = null
            };
        }
    }

    private static FamilyParameterLookupEntry? FindFamilyParameter(
        CollectedFamilyParameterRecord parameter,
        RevitObservedProjectParameterMetadata observed,
        FamilyParameterLookup familyParameterLookup,
        bool allowNameScopeFallback
    ) {
        if (observed.Identity.SharedGuid.HasValue) {
            return familyParameterLookup.SharedByGuid.TryGetValue(
                observed.Identity.SharedGuid.Value,
                out var sharedEntry
            )
                ? sharedEntry
                : null;
        }

        // Critical invariant:
        // Cross-document family lookup intentionally uses shared GUID only.
        // Non-shared lookup is allowed solely for true NameFallback observations
        // after project binding authority has already had a chance to claim the row.
        if (!allowNameScopeFallback || observed.Identity.Kind != RevitParameterIdentityKind.NameFallback)
            return null;

        var key = LoadedFamiliesCollectorSupport.GetParameterKey(parameter.Name, parameter.IsInstance);
        if (!familyParameterLookup.ByNameAndScope.TryGetValue(key, out var familyEntry))
            return null;

        return RevitParameterAuthorityResolver.MatchesFamilyParameter(observed, familyEntry.Metadata)
            ? familyEntry
            : null;
    }

    private static RevitProjectBindingMetadata? FindMergedProjectBinding(
        string? categoryName,
        RevitFamilyParameterMetadata familyParameter,
        IEnumerable<RevitProjectBindingMetadata> projectBindingLookup
    ) => projectBindingLookup.FirstOrDefault(binding =>
        RevitParameterAuthorityResolver.MatchesProjectSharedBinding(categoryName, familyParameter, binding)
    );

    private static RevitProjectBindingMetadata? FindProjectOnlyBinding(
        RevitObservedProjectParameterMetadata observed,
        IEnumerable<RevitProjectBindingMetadata> projectBindingLookup
    ) => projectBindingLookup.FirstOrDefault(binding =>
        RevitParameterAuthorityResolver.MatchesProjectOnlyBinding(observed, binding)
    );

    private static void ReportProjectBindingNameCollision(
        RevitObservedProjectParameterMetadata observed,
        RevitFamilyParameterMetadata familyParameter,
        IEnumerable<RevitProjectBindingMetadata> projectBindingLookup,
        RevitProjectBindingMetadata? mergedProjectBinding,
        string familyName,
        List<CollectedIssue> issues
    ) {
        var collisionBinding = projectBindingLookup.FirstOrDefault(binding =>
            RevitParameterAuthorityResolver.MatchesNameScopeCollision(observed, binding) &&
            (mergedProjectBinding == null ||
             !RevitParameterAuthorityResolver.RepresentsSameBinding(binding, mergedProjectBinding))
        );
        if (collisionBinding == null)
            return;

        var familyParameterKind = familyParameter.IsShared ? "family shared parameter" : "family parameter";
        var projectBindingKind = collisionBinding.IsShared ? "project shared parameter" : "project parameter";
        issues.Add(new CollectedIssue(
            "FamilyParameterProjectBindingNameCollision",
            CollectedIssueSeverity.Warning,
            $"'{observed.Identity.Name}' is both a {familyParameterKind} and a {projectBindingKind} in '{familyName}'. Name/scope collisions are diagnostic only; SP/PSP merges require a shared GUID match.",
            familyName,
            null,
            observed.Identity.Name
        ));
    }

    private static List<RevitProjectBindingMetadata> BuildProjectBindingLookup(
        Document projectDocument,
        IReadOnlyList<CollectedLoadedFamilyRecord> families
    ) {
        var categoryNames = families
            .Select(family => family.CategoryName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Cast<string>()
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var lookup = new List<RevitProjectBindingMetadata>();

        foreach (var (definition, binding) in DocumentManager.GetProjectParameterBindings(projectDocument)) {
            if (string.IsNullOrWhiteSpace(definition?.Name))
                continue;

            var bindingCategories = (binding.Categories?.Cast<Category>()
                    .Select(category => category.Name)
                    .Where(name => !string.IsNullOrWhiteSpace(name)))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList() ?? [];
            if (categoryNames.Count != 0) {
                bindingCategories = bindingCategories
                    .Where(categoryNames.Contains)
                    .ToList();
            }

            if (categoryNames.Count != 0 && bindingCategories.Count == 0)
                continue;

            lookup.Add(new RevitProjectBindingMetadata {
                Identity = RevitParameterIdentityFactory.FromDefinition(projectDocument, definition),
                IsInstance = binding is InstanceBinding,
                PropertiesGroup = definition.GetGroupTypeId(),
                DataType = definition.GetDataType(),
                CategoryNames = bindingCategories
            });
        }

        return lookup;
    }

    private static RevitObservedProjectParameterMetadata CreateObservedProjectParameterMetadata(
        CollectedFamilyParameterRecord parameter
    ) => new() {
        Identity = parameter.Identity,
        CategoryName = parameter.CategoryName,
        IsInstance = parameter.IsInstance,
        PropertiesGroup = string.IsNullOrWhiteSpace(parameter.GroupTypeId)
            ? new ForgeTypeId("")
            : new ForgeTypeId(parameter.GroupTypeId),
        DataType = string.IsNullOrWhiteSpace(parameter.DataTypeId)
            ? new ForgeTypeId("")
            : new ForgeTypeId(parameter.DataTypeId)
    };

    private static RevitObservedProjectParameterMetadata CreateFamilyLookupObservedProjectParameterMetadata(
        RevitObservedProjectParameterMetadata observed
    ) {
        // ParameterElementId is only meaningful inside the project document.
        // Once no project binding has claimed the observation, cross-document
        // family lookup must degrade to name/scope for non-shared family params.
        if (observed.Identity.Kind != RevitParameterIdentityKind.ParameterElement)
            return observed;

        return observed with {
            Identity = RevitParameterIdentityFactory.FromRaw(
                observed.Identity.Name,
                null,
                null,
                null
            )
        };
    }

    private static CollectedFamilyParameterRecord ApplyResolvedMetadata(
        CollectedFamilyParameterRecord parameter,
        RevitResolvedParameterMetadata resolved
    ) {
        var dataTypeId = NormalizeForgeTypeId(resolved.DataType);
        var groupTypeId = NormalizeForgeTypeId(resolved.PropertiesGroup);

        return parameter with {
            Identity = resolved.Identity,
            IsInstance = resolved.IsInstance,
            DataTypeId = dataTypeId,
            DataTypeLabel = dataTypeId == null ? null : RevitTypeLabelCatalog.GetLabelForSpec(resolved.DataType),
            GroupTypeId = groupTypeId,
            GroupTypeLabel =
                groupTypeId == null ? null : RevitTypeLabelCatalog.GetLabelForPropertyGroup(resolved.PropertiesGroup)
        };
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

    private sealed record FamilyParameterLookup(
        Dictionary<Guid, FamilyParameterLookupEntry> SharedByGuid,
        Dictionary<string, FamilyParameterLookupEntry> ByNameAndScope
    );

    private sealed record FamilyParameterLookupEntry(
        RevitFamilyParameterMetadata Metadata,
        FamilyParameter Parameter
    );
}
