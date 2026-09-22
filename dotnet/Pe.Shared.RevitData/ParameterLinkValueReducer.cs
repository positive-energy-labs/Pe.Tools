namespace Pe.Shared.RevitData;

public static class ParameterLinkValueReducer {
    public static bool TryReduce(
        ParameterLinkReducer reducer,
        IReadOnlyList<ParameterLinkValue> values,
        out ParameterLinkValue? reduced
    ) {
        reduced = null;
        if (values.Count == 0)
            return false;
        if (reducer == ParameterLinkReducer.First) {
            reduced = values[0];
            return true;
        }

        if (values.All(value => value.DoubleValue.HasValue)) {
            var number = reducer == ParameterLinkReducer.Min
                ? values.Min(value => value.DoubleValue!.Value)
                : values.Max(value => value.DoubleValue!.Value);
            reduced = values[0] with { DoubleValue = number, DisplayValue = null };
            return true;
        }

        if (values.All(value => value.IntegerValue.HasValue)) {
            var number = reducer == ParameterLinkReducer.Min
                ? values.Min(value => value.IntegerValue!.Value)
                : values.Max(value => value.IntegerValue!.Value);
            reduced = values[0] with { IntegerValue = number, DisplayValue = null };
            return true;
        }

        return false;
    }
}
