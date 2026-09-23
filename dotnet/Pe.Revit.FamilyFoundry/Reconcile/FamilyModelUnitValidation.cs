using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Reconcile;

public static class FamilyModelUnitValidation {
    public static IReadOnlyList<FamilyModelDiagnostic> Validate(FamilyModel resolved, JObject authored, Func<string, ExternalDefinition?> sharedSource) {
        ForgeTypeId? Spec(string name, FamilyModelParameter parameter) =>
            parameter.Shared == true ? parameter.SharedSpecId is { } id ? new ForgeTypeId(id) : sharedSource(name)?.GetDataType()
            : parameter.DataType is { } data ? SetParamMetadata.Spec(data) : null;
        var diagnostics = FamilyModelValidator.ValidateAuthoredUnits(authored, name => {
            if (!resolved.Parameters.TryGetValue(name, out var parameter)) return false;
            var spec = Spec(name, parameter);
            return spec is not null && spec != SpecTypeId.Number && spec != SpecTypeId.Int.Integer && UnitUtils.IsMeasurableSpec(spec);
        }).ToList();
        // A declared mappingUnit is judged against the spec the shared definition supplies, which parse could not see, and against Revit's own
        // units for it. An existing family-owned destination with neither dataType nor sharedSpecId is judged when the mapping runs.
        foreach (var (name, parameter) in resolved.Parameters) {
            if (parameter.MappingUnit is not { } symbol || Spec(name, parameter) is not { } spec) continue;
            try { _ = MappingUnit.Resolve(spec, symbol); }
            catch (ArgumentException exception) {
                diagnostics.Add(new FamilyModelDiagnostic(FamilyModelDiagnosticCodes.MappingUnitNotOfSpec, $"$.parameters.{name}.mappingUnit", exception.Message));
            }
        }
        return diagnostics;
    }
}
