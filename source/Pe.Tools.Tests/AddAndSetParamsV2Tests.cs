using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Serialization;

namespace Pe.Tools.Tests;

public sealed class AddAndSetParamsV2Tests {
    [Test]
    public async Task ProfileAdapter_SplitsFamilyDefinitions_AndKnownAssignments() {
        var snapshots = new List<ParamSnapshot> {
            new() {
                Name = "_FormulaParam",
                IsInstance = true,
                Formula = "Length * 2",
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                    ["Type A"] = null,
                    ["Type B"] = null
                }
            },
            new() {
                Name = "PE_E___Voltage",
                IsInstance = false,
                ValuesPerType = new Dictionary<string, string?>(StringComparer.Ordinal) {
                    ["Type A"] = "120 V",
                    ["Type B"] = "277 V"
                }
            }
        };

        var export = FamilyParamProfileAdapter.CreateFromSnapshots(snapshots);

        await Assert.That(export.AddFamilyParams.Parameters.Select(parameter => parameter.Name).ToList())
            .IsEquivalentTo(["_FormulaParam"]);
        await Assert.That(export.SetKnownParams.GlobalAssignments.Count).IsEqualTo(1);
        await Assert.That(export.SetKnownParams.GlobalAssignments[0].Parameter).IsEqualTo("_FormulaParam");
        await Assert.That(export.SetKnownParams.PerTypeAssignmentsTable.Count).IsEqualTo(1);
        await Assert.That(export.SetKnownParams.PerTypeAssignmentsTable[0].Parameter).IsEqualTo("PE_E___Voltage");
    }

}
