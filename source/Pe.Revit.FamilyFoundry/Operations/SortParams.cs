using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.Extensions.FamDocument;
using System.ComponentModel;

namespace Pe.FamilyFoundry.Operations;

public class SortParams(SortParamsSettings settings) : DocOperation<SortParamsSettings>(settings) {
    public override string Description =>
        $"Sort family parameters ({this.Settings.ParamNameSortOrder}, {this.Settings.ParamTypeSortOrder}, {this.Settings.ParamValueSortOrder})";

    public IComparer<string> GetNameComparer() {
        var order = this.Settings.ParamNameSortOrder;
        return order switch {
            ParamNameSortOrder.None => null,
            ParamNameSortOrder.Ascending => StringComparer.Ordinal,
            ParamNameSortOrder.Descending =>
                Comparer<string>.Create((a, b) => StringComparer.Ordinal.Compare(b, a)),
            _ => throw new ArgumentException($"Invalid param name sort order: {order}")
        };
    }

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();
        var parameters = doc.FamilyManager.GetParameters();

        var sortedParams = parameters.OrderBy(_ => 0);

        if (this.Settings.ParamTypeSortOrder != ParamTypeSortOrder.None) {
            sortedParams = sortedParams
                .ThenByDescending(p => this.Settings.ParamTypeSortOrder == ParamTypeSortOrder.SharedParamsFirst
                    ? p.IsShared
                    : !p.IsShared);
        }

        if (this.Settings.ParamValueSortOrder != ParamValueSortOrder.None) {
            sortedParams = sortedParams
                .ThenByDescending(p => this.Settings.ParamValueSortOrder == ParamValueSortOrder.FormulasFirst
                    ? p.IsDeterminedByFormula
                    : !p.IsDeterminedByFormula);
        }

        var nameComparer = this.GetNameComparer();
        if (nameComparer != null) sortedParams = sortedParams.ThenBy(p => p.Definition.Name, nameComparer);
        var sortedParamsList = sortedParams.ToList();
        doc.FamilyManager.ReorderParameters(sortedParamsList);

        logs.Add(new LogEntry($"Sorted {parameters.Count} parameters").Success());
        return new OperationLog(this.Name, logs);
    }
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamTypeSortOrder {
    None,
    SharedParamsFirst,
    FamilyParamsFirst
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamValueSortOrder {
    None,
    FormulasFirst,
    ValuesFirst
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamNameSortOrder {
    None,
    Ascending,
    Descending
}

public class SortParamsSettings : IOperationSettings {
    [Description(
        "Sort shared parameters first or family parameters first. Takes first priority. Options are None, SharedParamsFirst, or FamilyParamsFirst")]
    public ParamTypeSortOrder ParamTypeSortOrder { get; init; } = ParamTypeSortOrder.SharedParamsFirst;

    [Description(
        "Sort parameters with formulas first or values first. Takes second priority. Options are None, FormulasFirst, or ValuesFirst")]
    public ParamValueSortOrder ParamValueSortOrder { get; init; } = ParamValueSortOrder.None;

    [Description("Sort parameters alphabetically. Takes third priority. Options are None, Ascending, or Descending")]
    public ParamNameSortOrder ParamNameSortOrder { get; init; } = ParamNameSortOrder.Ascending;

    public bool Enabled { get; init; } = true;
}