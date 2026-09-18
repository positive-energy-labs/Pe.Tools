using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     `DataTypes.Measure` is a census of the Revit spec table, not a list: a member measures as Length exactly
///     when its `SpecTypeId` is measurable in feet. A Revit year that changes the table fails here, not in a plan.
/// </summary>
[TestFixture]
public sealed class DataTypeMeasureCensusTests {
    [Test]
    public void Length_measure_is_exactly_the_specs_Revit_measures_in_feet() {
        foreach (var dt in Enum.GetValues<DataType>()) {
            var spec = SetParamMetadata.Spec(dt);
            var inFeet = UnitUtils.IsMeasurableSpec(spec) && UnitUtils.GetValidUnits(spec).Contains(UnitTypeId.Feet);
            Assert.That(dt.Measure() == DataType.Length, Is.EqualTo(inFeet), $"{dt} ({spec.TypeId})");
        }
    }
}
