using Pe.Revit.DocumentData.Electrical;
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.ParameterLinks;

public static class ParameterLinksEngine {
    public const int MaxSourceElements = 5000;

    public static ParameterLinkEvaluation Evaluate(Document document, ParameterLinkProfile profile) =>
        BuildPlan(document, profile).Evaluation;

    public static (ParameterLinkEvaluation Evaluation, int AppliedWriteCount) Reconcile(
        Document document,
        ParameterLinkProfile profile
    ) {
        var plan = BuildPlan(document, profile);
        if (plan.Issues.Any(issue => issue.Severity == ParameterLinkIssueSeverity.Error))
            return (plan.Evaluation, 0);

        var changedWrites = plan.Writes.Where(write => write.Contract.Changed).ToList();
        if (changedWrites.Count == 0)
            return (plan.Evaluation, 0);

        var applied = 0;
        using var batch = new SubTransaction(document);
        try {
            if (batch.Start() != TransactionStatus.Started)
                throw new InvalidOperationException("Revit did not start the parameter-links write batch.");

            foreach (var write in changedWrites) {
                if (SetValue(write.TargetParameter, write.Contract.ProposedValue))
                    applied++;
                else {
                    plan.Issues.Add(Issue(
                        "WriteRejected",
                        ParameterLinkIssueSeverity.Error,
                        $"Revit rejected the proposed value for '{write.TargetParameter.Definition?.Name}'.",
                        write.Contract.DefinitionId,
                        write.Contract.AssignmentId,
                        targetUniqueId: write.Contract.TargetElementUniqueId));
                    break;
                }
            }

            if (plan.Issues.Any(issue => issue.Severity == ParameterLinkIssueSeverity.Error)) {
                RequireRollback(batch);
                applied = 0;
            } else if (batch.Commit() != TransactionStatus.Committed) {
                throw new InvalidOperationException("Revit did not commit the parameter-links write batch.");
            }
        } catch (Exception ex) {
            if (batch.GetStatus() == TransactionStatus.Started)
                RequireRollback(batch);
            if (!plan.Issues.Any(issue => issue.Code is "WriteRejected" or "WriteFailed")) {
                plan.Issues.Add(Issue(
                    "WriteFailed",
                    ParameterLinkIssueSeverity.Error,
                    ex.Message,
                    changedWrites[applied < changedWrites.Count ? applied : 0].Contract.DefinitionId,
                    changedWrites[applied < changedWrites.Count ? applied : 0].Contract.AssignmentId));
            }
            applied = 0;
        }

        return (ToEvaluation(plan.Writes, plan.Issues, plan.SourceIds), applied);
    }

    private static EvaluationPlan BuildPlan(Document document, ParameterLinkProfile profile) {
        var issues = Validate(profile);
        if (issues.Any(issue => issue.Severity == ParameterLinkIssueSeverity.Error))
            return new EvaluationPlan([], issues, []);

        var definitions = profile.Definitions.ToDictionary(definition => definition.Id, StringComparer.OrdinalIgnoreCase);
        var writes = new List<PlannedWrite>();
        var sourceIds = new HashSet<long>();

        foreach (var assignment in profile.Assignments.Where(assignment => assignment.Enabled)) {
            if (!definitions.TryGetValue(assignment.DefinitionId, out var definition))
                continue;

            var sources = ResolveSources(document, definition, assignment, issues);
            foreach (var source in sources) {
                sourceIds.Add(source.Id.Value());
                var sourceParameter = ParameterReferenceLookup.Find(
                    document,
                    source,
                    definition.SourceParameter,
                    ToLookupPreference(definition.SourceScope));
                if (sourceParameter == null) {
                    issues.Add(Issue(
                        "SourceParameterMissing",
                        ParameterLinkIssueSeverity.Warning,
                        $"Source parameter was not found on element {source.Id.Value()}.",
                        definition.Id,
                        assignment.Id,
                        source.UniqueId));
                    continue;
                }

                var sourceValue = ReadValue(sourceParameter, requireValue: true);
                if (sourceValue == null) {
                    issues.Add(Issue(
                        "SourceValueMissing",
                        ParameterLinkIssueSeverity.Warning,
                        $"Source parameter '{sourceParameter.Definition?.Name}' has no value on element {source.Id.Value()}.",
                        definition.Id,
                        assignment.Id,
                        source.UniqueId));
                    continue;
                }

                var targets = ResolveTargets(source, definition.Relationship);
                if (targets.Count == 0) {
                    issues.Add(Issue(
                        "RelationshipTargetMissing",
                        ParameterLinkIssueSeverity.Warning,
                        $"Relationship '{definition.Relationship}' found no target for source element {source.Id.Value()}.",
                        definition.Id,
                        assignment.Id,
                        source.UniqueId));
                }

                foreach (var target in targets)
                    AddCandidate(document, definition, assignment, source, sourceParameter, sourceValue, target, writes, issues);
            }
        }

        writes = CollapseTargets(writes, issues);
        return new EvaluationPlan(writes, issues, sourceIds);
    }

    public static List<ParameterLinkIssue> Validate(ParameterLinkProfile? profile) {
        var issues = new List<ParameterLinkIssue>();
        if (profile == null) {
            issues.Add(Issue("ProfileRequired", ParameterLinkIssueSeverity.Error,
                "A parameter-links profile is required."));
            return issues;
        }

        if (profile.FormatVersion != ParameterLinkProfile.CurrentFormatVersion) {
            issues.Add(Issue(
                "UnsupportedFormatVersion",
                ParameterLinkIssueSeverity.Error,
                $"Profile formatVersion {profile.FormatVersion} is unsupported; expected {ParameterLinkProfile.CurrentFormatVersion}."));
        }

        var definitions = profile.Definitions ?? [];
        var assignments = profile.Assignments ?? [];
        if (definitions.Count == 0) {
            issues.Add(Issue("DefinitionsRequired", ParameterLinkIssueSeverity.Error,
                "A profile requires at least one definition."));
        }

        if (profile.Definitions == null)
            issues.Add(Issue("DefinitionsRequired", ParameterLinkIssueSeverity.Error,
                "The definitions collection cannot be null."));
        if (profile.Assignments == null)
            issues.Add(Issue("AssignmentsRequired", ParameterLinkIssueSeverity.Error,
                "The assignments collection cannot be null."));

        foreach (var duplicate in definitions
                     .Where(definition => definition != null)
                     .Where(definition => !string.IsNullOrWhiteSpace(definition.Id))
                     .GroupBy(definition => definition.Id, StringComparer.OrdinalIgnoreCase)
                     .Where(group => group.Count() > 1)) {
            issues.Add(Issue("DuplicateDefinitionId", ParameterLinkIssueSeverity.Error,
                $"Definition id '{duplicate.Key}' is duplicated.", duplicate.Key));
        }

        foreach (var definition in definitions) {
            if (definition == null) {
                issues.Add(Issue("DefinitionRequired", ParameterLinkIssueSeverity.Error,
                    "Definitions cannot contain null entries."));
                continue;
            }

            if (string.IsNullOrWhiteSpace(definition.Id)) {
                issues.Add(Issue("DefinitionIdRequired", ParameterLinkIssueSeverity.Error,
                    "Every definition requires a non-empty id."));
                continue;
            }

            if (definition.SourceCategoryId == 0) {
                issues.Add(Issue("SourceCategoryRequired", ParameterLinkIssueSeverity.Error,
                    "A definition requires a sourceCategoryId.", definition.Id));
            }

            // Enum.IsDefined(Type, object): the generic overload is net5+, and net48 targets build this file.
            if (!Enum.IsDefined(typeof(ParameterLinkSourceScope), definition.SourceScope))
                issues.Add(Issue("SourceScopeUnsupported", ParameterLinkIssueSeverity.Error,
                    $"Source scope '{definition.SourceScope}' is unsupported.", definition.Id));
            if (!Enum.IsDefined(typeof(ParameterLinkRelationship), definition.Relationship))
                issues.Add(Issue("RelationshipUnsupported", ParameterLinkIssueSeverity.Error,
                    $"Relationship '{definition.Relationship}' is unsupported.", definition.Id));
            if (!Enum.IsDefined(typeof(ParameterLinkReducer), definition.Reducer))
                issues.Add(Issue("ReducerUnsupported", ParameterLinkIssueSeverity.Error,
                    $"Reducer '{definition.Reducer}' is unsupported.", definition.Id));

            var source = definition.SourceParameter == null
                ? null
                : ParameterReferenceResolver.Resolve([definition.SourceParameter]).SingleOrDefault();
            var target = definition.TargetParameter == null
                ? null
                : ParameterReferenceResolver.Resolve([definition.TargetParameter]).SingleOrDefault();
            if (source == null)
                issues.Add(Issue("SourceParameterRequired", ParameterLinkIssueSeverity.Error,
                    "A definition requires a resolvable source parameter reference.", definition.Id));
            if (target == null)
                issues.Add(Issue("TargetParameterRequired", ParameterLinkIssueSeverity.Error,
                    "A definition requires a resolvable target parameter reference.", definition.Id));

            if (source != null && target != null &&
                definition.Relationship == ParameterLinkRelationship.SameElement &&
                definition.SourceScope != ParameterLinkSourceScope.Type &&
                string.Equals(source.Identity.Key, target.Identity.Key, StringComparison.OrdinalIgnoreCase)) {
                issues.Add(Issue("DirectSelfLink", ParameterLinkIssueSeverity.Error,
                    "A same-element definition cannot write an instance parameter back to itself.", definition.Id));
            }
        }

        foreach (var duplicate in assignments
                     .Where(assignment => assignment != null)
                     .Where(assignment => !string.IsNullOrWhiteSpace(assignment.Id))
                     .GroupBy(assignment => assignment.Id, StringComparer.OrdinalIgnoreCase)
                     .Where(group => group.Count() > 1)) {
            issues.Add(Issue("DuplicateAssignmentId", ParameterLinkIssueSeverity.Error,
                $"Assignment id '{duplicate.Key}' is duplicated.", assignmentId: duplicate.Key));
        }

        var definitionIds = definitions
            .Where(definition => definition != null)
            .Select(definition => definition.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var assignment in assignments) {
            if (assignment == null) {
                issues.Add(Issue("AssignmentRequired", ParameterLinkIssueSeverity.Error,
                    "Assignments cannot contain null entries."));
                continue;
            }

            if (string.IsNullOrWhiteSpace(assignment.Id)) {
                issues.Add(Issue("AssignmentIdRequired", ParameterLinkIssueSeverity.Error,
                    "Every assignment requires a non-empty id."));
                continue;
            }

            if (string.IsNullOrWhiteSpace(assignment.DefinitionId) || !definitionIds.Contains(assignment.DefinitionId)) {
                issues.Add(Issue("AssignmentDefinitionMissing", ParameterLinkIssueSeverity.Error,
                    $"Assignment '{assignment.Id}' references missing definition '{assignment.DefinitionId}'.",
                    assignmentId: assignment.Id));
            }

            if (assignment.SourceElementUniqueIds == null)
                issues.Add(Issue("AssignmentSourcesRequired", ParameterLinkIssueSeverity.Error,
                    $"Assignment '{assignment.Id}' requires a sourceElementUniqueIds collection.",
                    assignmentId: assignment.Id));
        }

        return issues;
    }

    private static List<Element> ResolveSources(
        Document document,
        ParameterLinkDefinition definition,
        ParameterLinkAssignment assignment,
        List<ParameterLinkIssue> issues
    ) {
        IEnumerable<Element> sources;
        if (assignment.SourceElementUniqueIds.Count != 0) {
            sources = assignment.SourceElementUniqueIds
                .Select(uniqueId => TryGetElement(document, uniqueId))
                .Where(element => element != null)
                .Cast<Element>()
                .Where(element => element.Category?.Id.Value() == definition.SourceCategoryId);
        } else {
            try {
                sources = new FilteredElementCollector(document)
                    .WhereElementIsNotElementType()
                    .WherePasses(new ElementCategoryFilter(((long)definition.SourceCategoryId).ToElementId()))
                    .ToElements();
            } catch (Exception ex) {
                issues.Add(Issue("SourceCategoryInvalid", ParameterLinkIssueSeverity.Error, ex.Message, definition.Id,
                    assignment.Id));
                return [];
            }
        }

        var materialized = sources
            .OrderBy(element => element.UniqueId, StringComparer.Ordinal)
            .Take(MaxSourceElements + 1)
            .ToList();
        if (materialized.Count > MaxSourceElements) {
            issues.Add(Issue("SourceLimitExceeded", ParameterLinkIssueSeverity.Error,
                $"Assignment '{assignment.Id}' exceeds the {MaxSourceElements}-source safety limit.",
                definition.Id, assignment.Id));
            return [];
        }

        return materialized;
    }

    private static Element? TryGetElement(Document document, string uniqueId) {
        try {
            return document.GetElement(uniqueId);
        } catch {
            return null;
        }
    }

    private static IReadOnlyList<Element> ResolveTargets(Element source, ParameterLinkRelationship relationship) =>
        relationship switch {
            ParameterLinkRelationship.SameElement => [source],
            ParameterLinkRelationship.ElectricalEquipmentCircuits when source is FamilyInstance family =>
                ElectricalCollectorSupport.GetElectricalSystems(family)
                    .GroupBy(system => system.Id.Value())
                    .Select(group => (Element)group.First())
                    .ToList(),
            _ => []
        };

    private static void AddCandidate(
        Document document,
        ParameterLinkDefinition definition,
        ParameterLinkAssignment assignment,
        Element source,
        Parameter sourceParameter,
        ParameterLinkValue sourceValue,
        Element target,
        List<PlannedWrite> writes,
        List<ParameterLinkIssue> issues
    ) {
        var targetParameter = ParameterReferenceLookup.Find(
            document,
            target,
            definition.TargetParameter,
            RevitParameterLookupPreference.InstanceOnly);
        if (targetParameter == null) {
            issues.Add(Issue("TargetParameterMissing", ParameterLinkIssueSeverity.Warning,
                $"Target parameter was not found on element {target.Id.Value()}.", definition.Id, assignment.Id,
                source.UniqueId, target.UniqueId));
            return;
        }

        if (targetParameter.IsReadOnly) {
            issues.Add(Issue("TargetReadOnly", ParameterLinkIssueSeverity.Error,
                $"Target parameter '{targetParameter.Definition?.Name}' is read-only on element {target.Id.Value()}.",
                definition.Id, assignment.Id, source.UniqueId, target.UniqueId));
            return;
        }

        if (!IsCompatible(sourceParameter, targetParameter)) {
            issues.Add(Issue("IncompatibleParameters", ParameterLinkIssueSeverity.Error,
                $"Source '{sourceParameter.Definition?.Name}' and target '{targetParameter.Definition?.Name}' have incompatible storage or specs.",
                definition.Id, assignment.Id, source.UniqueId, target.UniqueId));
            return;
        }

        var current = ReadValue(targetParameter);
        if (current == null) {
            issues.Add(Issue("TargetValueUnsupported", ParameterLinkIssueSeverity.Error,
                $"Target parameter '{targetParameter.Definition?.Name}' has an unsupported storage type.",
                definition.Id, assignment.Id, source.UniqueId, target.UniqueId));
            return;
        }

        writes.Add(new PlannedWriteCandidate(
            definition,
            assignment,
            source,
            target,
            targetParameter,
            current,
            sourceValue).ToPlannedWrite());
    }

    private static List<PlannedWrite> CollapseTargets(
        List<PlannedWrite> candidates,
        List<ParameterLinkIssue> issues
    ) {
        var writes = new List<PlannedWrite>();
        foreach (var assignmentTarget in candidates.GroupBy(candidate => new {
                     candidate.Contract.DefinitionId,
                     candidate.Contract.TargetElementId,
                     ParameterId = candidate.TargetParameter.Id.Value()
                 })) {
            var ordered = assignmentTarget
                .OrderBy(candidate => candidate.SourceUniqueId, StringComparer.Ordinal)
                .ThenBy(candidate => candidate.Contract.AssignmentId, StringComparer.Ordinal)
                .ToList();
            var first = ordered[0];
            if (!ParameterLinkValueReducer.TryReduce(
                    first.Reducer,
                    ordered.Select(candidate => candidate.Contract.ProposedValue).ToList(),
                    out var proposed) || proposed == null) {
                issues.Add(Issue("ReducerUnsupported", ParameterLinkIssueSeverity.Error,
                    $"Reducer '{first.Reducer}' requires numeric source values.", first.Contract.DefinitionId,
                    first.Contract.AssignmentId, targetUniqueId: first.Contract.TargetElementUniqueId));
                continue;
            }

            writes.Add(first with {
                Contract = first.Contract with {
                    ProposedValue = proposed,
                    Changed = !ValuesEqual(first.Contract.CurrentValue, proposed)
                }
            });
        }

        var collapsed = new List<PlannedWrite>();
        foreach (var target in writes.GroupBy(write => new {
                     write.Contract.TargetElementId,
                     ParameterId = write.TargetParameter.Id.Value()
                 })) {
            var group = target.ToList();
            if (group.Skip(1).Any(write => !ValuesEqual(
                    group[0].Contract.ProposedValue,
                    write.Contract.ProposedValue))) {
                issues.Add(Issue("ConflictingWrites", ParameterLinkIssueSeverity.Error,
                    $"Multiple active assignments propose different values for target element {target.Key.TargetElementId}."));
                continue;
            }

            collapsed.Add(group
                .OrderBy(write => write.Contract.AssignmentId, StringComparer.Ordinal)
                .First());
        }

        return collapsed;
    }

    private static bool IsCompatible(Parameter source, Parameter target) {
        if (source.StorageType != target.StorageType)
            return false;
        return string.Equals(
            source.Definition?.GetDataType()?.TypeId,
            target.Definition?.GetDataType()?.TypeId,
            StringComparison.OrdinalIgnoreCase);
    }

    private static ParameterLinkValue? ReadValue(Parameter parameter, bool requireValue = false) {
        if (requireValue && !parameter.HasValue)
            return null;

        var specTypeId = parameter.Definition?.GetDataType()?.TypeId;
        return parameter.StorageType switch {
            StorageType.String => new ParameterLinkValue {
                StorageType = nameof(StorageType.String), SpecTypeId = specTypeId,
                StringValue = parameter.AsString(), DisplayValue = parameter.AsValueString()
            },
            StorageType.Integer => new ParameterLinkValue {
                StorageType = nameof(StorageType.Integer), SpecTypeId = specTypeId,
                IntegerValue = parameter.AsInteger(), DisplayValue = parameter.AsValueString()
            },
            StorageType.Double => new ParameterLinkValue {
                StorageType = nameof(StorageType.Double), SpecTypeId = specTypeId,
                DoubleValue = parameter.AsDouble(), DisplayValue = parameter.AsValueString()
            },
            StorageType.ElementId => new ParameterLinkValue {
                StorageType = nameof(StorageType.ElementId), SpecTypeId = specTypeId,
                ElementIdValue = parameter.AsElementId()?.Value(), DisplayValue = parameter.AsValueString()
            },
            _ => null
        };
    }

    private static bool SetValue(Parameter parameter, ParameterLinkValue value) => parameter.StorageType switch {
        StorageType.String => parameter.Set(value.StringValue ?? string.Empty),
        StorageType.Integer when value.IntegerValue.HasValue => parameter.Set(value.IntegerValue.Value),
        StorageType.Double when value.DoubleValue.HasValue => parameter.Set(value.DoubleValue.Value),
        StorageType.ElementId when value.ElementIdValue.HasValue => parameter.Set(value.ElementIdValue.Value.ToElementId()),
        _ => false
    };

    private static void RequireRollback(SubTransaction transaction) {
        if (transaction.RollBack() != TransactionStatus.RolledBack)
            throw new InvalidOperationException("Revit did not roll back the parameter-links write batch.");
    }

    private static bool ValuesEqual(ParameterLinkValue left, ParameterLinkValue right) {
        if (!string.Equals(left.StorageType, right.StorageType, StringComparison.Ordinal))
            return false;
        if (left.DoubleValue.HasValue || right.DoubleValue.HasValue)
            return left.DoubleValue.HasValue && right.DoubleValue.HasValue &&
                   Math.Abs(left.DoubleValue.Value - right.DoubleValue.Value) <= 1e-9;
        return left.IntegerValue == right.IntegerValue &&
               left.ElementIdValue == right.ElementIdValue &&
               string.Equals(left.StringValue, right.StringValue, StringComparison.Ordinal);
    }

    private static RevitParameterLookupPreference ToLookupPreference(ParameterLinkSourceScope scope) => scope switch {
        ParameterLinkSourceScope.Instance => RevitParameterLookupPreference.InstanceOnly,
        ParameterLinkSourceScope.Type => RevitParameterLookupPreference.TypeOnly,
        _ => RevitParameterLookupPreference.InstanceThenType
    };

    private static ParameterLinkIssue Issue(
        string code,
        ParameterLinkIssueSeverity severity,
        string message,
        string? definitionId = null,
        string? assignmentId = null,
        string? sourceUniqueId = null,
        string? targetUniqueId = null
    ) => new() {
        Code = code,
        Severity = severity,
        Message = message,
        DefinitionId = definitionId,
        AssignmentId = assignmentId,
        SourceElementUniqueId = sourceUniqueId,
        TargetElementUniqueId = targetUniqueId
    };

    private static ParameterLinkEvaluation ToEvaluation(
        IReadOnlyList<PlannedWrite> writes,
        List<ParameterLinkIssue> issues,
        HashSet<long> sourceIds
    ) => new() {
        Writes = writes.Select(write => write.Contract).ToList(),
        Issues = issues,
        SourceElementCount = sourceIds.Count,
        TargetElementCount = writes.Select(write => write.Contract.TargetElementId).Distinct().Count(),
        ChangedWriteCount = writes.Count(write => write.Contract.Changed)
    };

    private sealed record EvaluationPlan(
        List<PlannedWrite> Writes,
        List<ParameterLinkIssue> Issues,
        HashSet<long> SourceIds
    ) {
        public ParameterLinkEvaluation Evaluation => ToEvaluation(this.Writes, this.Issues, this.SourceIds);
    }

    private sealed record PlannedWrite(
        ParameterLinkWrite Contract,
        Parameter TargetParameter,
        ParameterLinkReducer Reducer,
        string SourceUniqueId
    );

    private sealed record PlannedWriteCandidate(
        ParameterLinkDefinition Definition,
        ParameterLinkAssignment Assignment,
        Element Source,
        Element Target,
        Parameter TargetParameter,
        ParameterLinkValue Current,
        ParameterLinkValue Proposed
    ) {
        public PlannedWrite ToPlannedWrite() => new(
            new ParameterLinkWrite {
                DefinitionId = this.Definition.Id,
                AssignmentId = this.Assignment.Id,
                TargetElementId = this.Target.Id.Value(),
                TargetElementUniqueId = this.Target.UniqueId,
                TargetElementName = this.Target.Name,
                TargetParameter = ParameterIdentityFactory.FromParameter(this.TargetParameter),
                CurrentValue = this.Current,
                ProposedValue = this.Proposed,
                Changed = !ValuesEqual(this.Current, this.Proposed)
            },
            this.TargetParameter,
            this.Definition.Reducer,
            this.Source.UniqueId);
    }

}
