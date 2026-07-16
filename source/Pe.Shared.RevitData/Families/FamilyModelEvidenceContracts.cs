using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.RevitData;

namespace Pe.Shared.RevitData.Families;

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyModelValueSource {
    AuthoredGlobal,
    AuthoredTypeOverride,
    Formula,
    RevitDefault,
    Unresolved
}

[JsonConverter(typeof(StringEnumConverter))]
public enum FamilyModelEvidenceProvenance {
    Exact,
    Inferred,
    Unresolved
}

public sealed record FamilyModelResolvedValue(
    string? Value,
    FamilyModelValueSource Source,
    FamilyModelEvidenceProvenance Provenance,
    string? Formula = null
);

public sealed record FamilyModelParameterEvidence(
    string Name,
    bool IsShared,
    string? PropertiesGroup,
    IReadOnlyDictionary<string, FamilyModelResolvedValue> ValuesPerType
);

public sealed record FamilyModelEvidenceDiagnostic(
    string Code,
    string Path,
    string Message,
    FamilyModelEvidenceProvenance Provenance,
    double? Confidence = null
);

public sealed record FamilyModelEvidence(
    IReadOnlyList<string> TypeNames,
    IReadOnlyList<FamilyModelParameterEvidence> Parameters,
    IReadOnlyList<FamilyModelEvidenceDiagnostic> Diagnostics
);

public static class FamilyModelEvidenceProjector {
    public static FamilyModelEvidence Project(FamilyModel model, FamilySnapshotRecord snapshot) {
        var typeNames = model.Types.Count > 0 ? model.Types.Keys.ToList() : snapshot.TypeNames.ToList();
        var observed = snapshot.Parameters.ToDictionary(
            parameter => parameter.Definition.Identity.Name,
            StringComparer.Ordinal);
        var parameters = model.FamilyParameters
            .Select(pair => CreateParameterEvidence(pair.Key, pair.Value, false, typeNames, model, observed))
            .Concat(model.SharedParameters.Select(pair =>
                CreateParameterEvidence(pair.Key, pair.Value, true, typeNames, model, observed)))
            .ToList();
        var diagnostics = snapshot.Issues.Select(issue => new FamilyModelEvidenceDiagnostic(
                issue.Code,
                EvidencePath(issue),
                issue.Message,
                issue.Severity switch {
                    RevitDataIssueSeverity.Error => FamilyModelEvidenceProvenance.Unresolved,
                    RevitDataIssueSeverity.Warning => FamilyModelEvidenceProvenance.Inferred,
                    _ => FamilyModelEvidenceProvenance.Exact
                }))
            .Concat(model.Unmodeled.Select(fact => new FamilyModelEvidenceDiagnostic(
                fact.Reason,
                fact.Path,
                $"Observable Revit state is not represented by the authored model: {fact.Reason}.",
                FamilyModelEvidenceProvenance.Unresolved)))
            .ToList();
        return new FamilyModelEvidence(typeNames, parameters, diagnostics);
    }

    private static FamilyModelParameterEvidence CreateParameterEvidence(
        string name,
        FamilyModelParameter authored,
        bool isShared,
        IReadOnlyList<string> typeNames,
        FamilyModel model,
        IReadOnlyDictionary<string, FamilyParameterSnapshot> observed
    ) {
        observed.TryGetValue(name, out var snapshot);
        var values = typeNames.ToDictionary(
            typeName => typeName,
            typeName => ResolveValue(name, typeName, authored, model, snapshot),
            StringComparer.Ordinal);
        return new FamilyModelParameterEvidence(
            name,
            isShared,
            authored.PropertiesGroup,
            values);
    }

    private static FamilyModelResolvedValue ResolveValue(
        string parameterName,
        string typeName,
        FamilyModelParameter authored,
        FamilyModel model,
        FamilyParameterSnapshot? observed
    ) {
        string? observedValue = null;
        if (observed != null)
            observed.ValuesPerType.TryGetValue(typeName, out observedValue);
        var formula = authored.Formula ?? observed?.Formula;
        if (!string.IsNullOrWhiteSpace(formula))
            return Resolved(observedValue, FamilyModelValueSource.Formula, formula);

        if (model.Types.TryGetValue(typeName, out var overrides) &&
            overrides.ContainsKey(parameterName))
            return Resolved(observedValue, FamilyModelValueSource.AuthoredTypeOverride);

        if (authored.Value != null)
            return Resolved(observedValue, FamilyModelValueSource.AuthoredGlobal);

        return observedValue != null
            ? Resolved(observedValue, FamilyModelValueSource.RevitDefault)
            : new FamilyModelResolvedValue(
                null,
                FamilyModelValueSource.Unresolved,
                FamilyModelEvidenceProvenance.Unresolved);
    }

    private static FamilyModelResolvedValue Resolved(
        string? value,
        FamilyModelValueSource source,
        string? formula = null
    ) => new(
        value,
        source,
        value == null ? FamilyModelEvidenceProvenance.Unresolved : FamilyModelEvidenceProvenance.Exact,
        formula);

    private static string EvidencePath(RevitDataIssue issue) {
        if (!string.IsNullOrWhiteSpace(issue.ParameterName))
            return $"$.parameters.{issue.ParameterName}";
        if (!string.IsNullOrWhiteSpace(issue.TypeName))
            return $"$.types.{issue.TypeName}";
        return "$";
    }
}
