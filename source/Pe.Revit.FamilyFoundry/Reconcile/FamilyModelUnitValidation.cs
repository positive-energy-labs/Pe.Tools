using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Reconcile;

public static class FamilyModelUnitValidation {
    public static IReadOnlyList<FamilyModelDiagnostic> Validate(FamilyModel resolved, JObject authored, Func<string, ExternalDefinition?> sharedSource) =>
        FamilyValueUnits.Validate(authored, name => {
            if (!resolved.Parameters.TryGetValue(name, out var parameter)) return false;
            var spec = parameter.Shared == true ? parameter.SharedSpecId is { } id ? new ForgeTypeId(id) : sharedSource(name)?.GetDataType()
                : parameter.DataType is { } data ? SetParamMetadata.Spec(data) : null;
            return spec is not null && spec != SpecTypeId.Number && spec != SpecTypeId.Int.Integer && UnitUtils.IsMeasurableSpec(spec);
        });
}
