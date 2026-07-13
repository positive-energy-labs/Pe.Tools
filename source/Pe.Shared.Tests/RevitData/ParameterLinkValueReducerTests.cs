using Pe.Shared.RevitData;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class ParameterLinkValueReducerTests {
    [Test]
    public void Max_reduces_internal_numeric_values_and_rejects_non_numeric_values() {
        var values = new[] {
            Double(12.5),
            Double(42),
            Double(18.25)
        };

        var ok = ParameterLinkValueReducer.TryReduce(ParameterLinkReducer.Max, values, out var reduced);
        var stringOk = ParameterLinkValueReducer.TryReduce(
            ParameterLinkReducer.Max,
            [new ParameterLinkValue { StorageType = "String", StringValue = "42" }],
            out var stringReduced);

        Assert.Multiple(() => {
            Assert.That(ok, Is.True);
            Assert.That(reduced?.DoubleValue, Is.EqualTo(42));
            Assert.That(stringOk, Is.False);
            Assert.That(stringReduced, Is.Null);
        });
    }

    private static ParameterLinkValue Double(double value) => new() {
        StorageType = "Double",
        SpecTypeId = "autodesk.spec.aec:current-2.0.0",
        DoubleValue = value
    };
}
