namespace Pe.Revit.DocumentData.Schedules.Collect;

/// <summary>
///     Amortizes per-(element × column) parameter resolution for schedule subject reads. Mirrors
///     ScheduleCollectorSupport.ResolveParameter semantics exactly, but materializes each source element's
///     parameter-id map once (instead of enumerating Element.Parameters per column) and resolves each
///     ParameterElement's name once per schedule (instead of doc.GetElement per element × column).
/// </summary>
internal sealed class ScheduleParameterResolutionCache {
    private readonly Document _doc;
    private readonly Dictionary<long, string?> _parameterElementNames = new();
    private readonly Dictionary<long, Dictionary<long, Parameter>> _parametersBySourceId = new();

    public ScheduleParameterResolutionCache(Document doc) {
        this._doc = doc;
    }

    public Parameter? Resolve(Element source, ElementId? parameterId, string fallbackName) {
        if (parameterId == null || parameterId == ElementId.InvalidElementId)
            return source.LookupParameter(fallbackName);

        var rawParameterId = parameterId.Value();
        if (rawParameterId < 0) {
            try {
                return source.get_Parameter((BuiltInParameter)rawParameterId);
            } catch {
                return source.LookupParameter(fallbackName);
            }
        }

        if (this.GetParameterMap(source).TryGetValue(rawParameterId, out var exactMatch))
            return exactMatch;

        var parameterName = this.GetParameterElementName(rawParameterId, parameterId);
        return source.LookupParameter(parameterName ?? fallbackName);
    }

    private Dictionary<long, Parameter> GetParameterMap(Element source) {
        var sourceId = source.Id.Value();
        if (this._parametersBySourceId.TryGetValue(sourceId, out var map))
            return map;

        map = new Dictionary<long, Parameter>();
        foreach (var parameter in source.Parameters.Cast<Parameter>()) {
            var id = parameter.Id.Value();
            if (!map.ContainsKey(id))
                map[id] = parameter; // first wins, matching the FirstOrDefault the cache replaces
        }

        this._parametersBySourceId[sourceId] = map;
        return map;
    }

    private string? GetParameterElementName(long rawParameterId, ElementId parameterId) {
        if (this._parameterElementNames.TryGetValue(rawParameterId, out var name))
            return name;

        name = this._doc.GetElement(parameterId)?.Name;
        this._parameterElementNames[rawParameterId] = name;
        return name;
    }
}
