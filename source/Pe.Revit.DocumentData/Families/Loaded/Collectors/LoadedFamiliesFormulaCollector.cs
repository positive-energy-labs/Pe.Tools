using Pe.Revit.DocumentData.Families.Loaded.Models;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Shared.RevitData.Families;
namespace Pe.Revit.DocumentData.Families.Loaded.Collectors;

/// <summary>
///     Supplements collected project observations with family-doc truth (formulas) and resolves parameter
///     authority (family vs project binding). Family-doc truth arrives as pre-extracted
///     <see cref="FamilySnapshotRecord" />s (see FamilySnapshotExtractor) — this collector never opens
///     documents itself.
/// </summary>
public static class LoadedFamiliesFormulaCollector {
    public static List<CollectedLoadedFamilyRecord> Supplement(
        Document projectDocument,
        IReadOnlyList<CollectedLoadedFamilyRecord> families,
        IReadOnlyDictionary<long, FamilySnapshotRecord> recordsByFamilyId,
        Action<string, TimeSpan>? onFamilySupplemented = null
    ) {
        var projectBindingLookup = BuildProjectBindingLookup(projectDocument, families);
        return families
            .Select(family => {
                var stopwatch = Stopwatch.StartNew();
                var supplementedFamily = SupplementFamily(family, recordsByFamilyId, projectBindingLookup);
                onFamilySupplemented?.Invoke(supplementedFamily.FamilyName, stopwatch.Elapsed);
                return supplementedFamily;
            })
            .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static CollectedLoadedFamilyRecord SupplementFamily(
        CollectedLoadedFamilyRecord family,
        IReadOnlyDictionary<long, FamilySnapshotRecord> recordsByFamilyId,
        List<RevitProjectBindingMetadata> projectBindingLookup
    ) {
        if (family.Parameters.Count == 0)
            return family;

        var issues = family.Issues.ToList();
        if (!recordsByFamilyId.TryGetValue(family.FamilyId, out var record)) {
            issues.Add(new CollectedIssue(
                "FamilyFormulaCollectionFailed",
                CollectedIssueSeverity.Error,
                $"No extracted family snapshot is available for family '{family.FamilyName}'.",
                family.FamilyName
            ));
            return family with { Issues = issues };
        }

        issues.AddRange(record.Issues.Select(issue => new CollectedIssue(
            issue.Code,
            ToCollectedSeverity(issue.Severity),
            issue.Message,
            family.FamilyName
        )));

        var parameterLookup = BuildFamilyParameterLookup(record, family.FamilyName, issues);
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
    }

    private static CollectedIssueSeverity ToCollectedSeverity(RevitDataIssueSeverity severity) =>
        severity switch {
            RevitDataIssueSeverity.Error => CollectedIssueSeverity.Error,
            RevitDataIssueSeverity.Warning => CollectedIssueSeverity.Warning,
            _ => CollectedIssueSeverity.Info
        };

    private static FamilyParameterLookup BuildFamilyParameterLookup(
        FamilySnapshotRecord record,
        string familyName,
        List<CollectedIssue> issues
    ) {
        var sharedByGuid = new Dictionary<Guid, FamilyParameterLookupEntry>();
        var byNameAndScope = new Dictionary<string, FamilyParameterLookupEntry>(StringComparer.Ordinal);

        foreach (var parameterSnapshot in record.Parameters) {
            var entry = new FamilyParameterLookupEntry(
                new RevitFamilyParameterMetadata { Definition = parameterSnapshot.Definition },
                parameterSnapshot.Formula
            );

            if (entry.Metadata.IsInstance == null)
                continue;

            var key = LoadedFamiliesCollectorSupport.GetParameterKey(
                entry.Metadata.Identity.Name,
                entry.Metadata.IsInstance.Value
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
            } else
                byNameAndScope[key] = entry;

            if (!Guid.TryParse(entry.Metadata.Identity.SharedGuid, out var sharedGuid))
                continue;

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
            projectObservedBinding == null
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

            return ApplyFamilyFormula(classifiedParameter, familyParameter.Formula);
        }

        if (effectiveProjectBinding != null)
            return classifiedParameter with { FormulaState = CollectedFormulaState.NotApplicable, Formula = null };

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
        string? extractedFormula
    ) {
        var formula = string.IsNullOrWhiteSpace(extractedFormula) ? null : extractedFormula;
        return parameter with {
            FormulaState = formula == null ? CollectedFormulaState.None : CollectedFormulaState.Present,
            Formula = formula
        };
    }

    private static FamilyParameterLookupEntry? FindFamilyParameter(
        CollectedFamilyParameterRecord parameter,
        RevitObservedProjectParameterMetadata observed,
        FamilyParameterLookup familyParameterLookup,
        bool allowNameScopeFallback
    ) {
        if (Guid.TryParse(observed.Identity.SharedGuid, out var sharedGuid)) {
            return familyParameterLookup.SharedByGuid.TryGetValue(
                sharedGuid,
                out var sharedEntry
            )
                ? sharedEntry
                : null;
        }

        // Critical invariant:
        // Cross-document family lookup intentionally uses shared GUID only.
        // Non-shared lookup is allowed solely for true NameFallback observations
        // after project binding authority has already had a chance to claim the row.
        if (!allowNameScopeFallback || observed.Identity.Kind != ParameterIdentityKind.NameFallback)
            return null;

        if (parameter.IsInstance == null)
            return null;

        var key = LoadedFamiliesCollectorSupport.GetParameterKey(parameter.Name, parameter.IsInstance.Value);
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

        foreach (var (definition, binding) in projectDocument.GetProjectParameterBindings()) {
            if (string.IsNullOrWhiteSpace(definition?.Name))
                continue;

            var bindingCategories = (binding.Categories?.Cast<Category>()
                                         .Select(category => category.Name)
                                         .Where(name => !string.IsNullOrWhiteSpace(name))
                                     ?? Array.Empty<string?>())
                .Select(name => name!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (categoryNames.Count != 0) {
                bindingCategories = bindingCategories
                    .Where(categoryNames.Contains)
                    .ToList();
            }

            if (categoryNames.Count != 0 && bindingCategories.Count == 0)
                continue;

            var dataType = definition.GetDataType();
            var propertiesGroup = definition.GetGroupTypeId();
            lookup.Add(new RevitProjectBindingMetadata {
                Definition = new ParameterDefinitionDescriptor(
                    ParameterIdentityFactory.FromDefinition(projectDocument, definition),
                    binding is InstanceBinding,
                    NormalizeForgeTypeId(dataType),
                    null,
                    NormalizeForgeTypeId(propertiesGroup),
                    null
                ),
                CategoryNames = bindingCategories
            });
        }

        return lookup;
    }

    private static RevitObservedProjectParameterMetadata CreateObservedProjectParameterMetadata(
        CollectedFamilyParameterRecord parameter
    ) => new() {
        Definition = parameter.Definition,
        CategoryName = parameter.CategoryName
    };

    private static RevitObservedProjectParameterMetadata CreateFamilyLookupObservedProjectParameterMetadata(
        RevitObservedProjectParameterMetadata observed
    ) {
        // ParameterElementId is only meaningful inside the project document.
        // Once no project binding has claimed the observation, cross-document
        // family lookup must degrade to name/scope for non-shared family params.
        if (observed.Identity.Kind != ParameterIdentityKind.ParameterElement)
            return observed;

        return observed with {
            Definition = observed.Definition with {
                Identity = ParameterIdentityFactory.FromRaw(
                    observed.Identity.Name,
                    null,
                    null,
                    null
                )
            }
        };
    }

    private static CollectedFamilyParameterRecord ApplyResolvedMetadata(
        CollectedFamilyParameterRecord parameter,
        RevitResolvedParameterMetadata resolved
    ) {
        var dataTypeId = NormalizeForgeTypeId(resolved.DataType);
        var groupTypeId = NormalizeForgeTypeId(resolved.PropertiesGroup);

        return parameter with {
            Definition = new ParameterDefinitionDescriptor(
                resolved.Identity,
                resolved.IsInstance,
                dataTypeId,
                dataTypeId == null ? null : RevitLabelCatalog.GetLabelForSpec(resolved.DataType),
                groupTypeId,
                groupTypeId == null ? null : RevitLabelCatalog.GetLabelForPropertyGroup(resolved.PropertiesGroup)
            )
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
        string? Formula
    );
}
