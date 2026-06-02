using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;

namespace Pe.Revit.FamilyFoundry.Operations;

public sealed class MapFamilyParams(MapParamsSettings settings)
    : TypeOperation<MapParamsSettings>(settings) {
    public override string Description => "Map legacy parameter values to desired local family parameters for each family type";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var familyManager = doc.FamilyManager;
        var incomplete = groupContext.GetAllInComplete();
        if (incomplete.Count == 0)
            this.AbortOperation("All mappings were handled by prior operations");

        foreach (var (mapping, log) in this.Settings.GetIncompleteMappings(groupContext)) {
            var targetParameter = familyManager.FindParameter(mapping.NewName);
            if (targetParameter == null)
                continue;

            var sourceParameters = this.Settings.GetRankedCurrParams(mapping.CurrNames, familyManager, processingContext);
            var succeeded = false;
            Exception? lastException = null;
            var lastMappingDescription = string.Empty;

            foreach (var sourceParameter in sourceParameters) {
                var mappingDescription = $"{sourceParameter.Definition.Name} → {mapping.NewName}";
                lastMappingDescription = mappingDescription;

                try {
                    var sourceValue = doc.GetValue(sourceParameter);
                    if (sourceValue is string text && string.IsNullOrWhiteSpace(text))
                        continue;

                    if (targetParameter.Formula != null)
                        _ = doc.UnsetFormula(targetParameter);

                    _ = doc.SetValue(targetParameter, sourceParameter, mapping.MappingStrategy);
                    _ = log.Defer(targetParameter != sourceParameter
                        ? $"Coerced {mappingDescription} using {mapping.MappingStrategy}"
                        : $"Set {mappingDescription}");
                    succeeded = true;
                    break;
                } catch (Exception ex) {
                    lastException = ex;
                }
            }

            if (!succeeded && lastException != null && !log.IsComplete)
                _ = log.Error(lastMappingDescription, lastException);
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }
}
