using NUnit.Framework;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>Deterministic lane: the parameter matrix → <c>parameters</c> + <c>types</c> projection, no Document.</summary>
[TestFixture]
public sealed class FamilySnapshotProjectionTests {
    private static FamilyParameterSnapshot Row(
        string name, bool isInstance, string? dataTypeId, string? sharedGuid = null, string? formula = null,
        params (string Type, string? Value)[] cells
    ) => new(
        new ParameterDefinitionDescriptor(
            new ParameterIdentity(sharedGuid != null ? $"shared-guid:{sharedGuid}" : $"name:{name}",
                sharedGuid != null ? ParameterIdentityKind.SharedGuid : ParameterIdentityKind.NameFallback, name, null, sharedGuid, null),
            isInstance, dataTypeId, null, "autodesk.parameter.group:geometry-1.0.0", "Localized dimensions label"),
        sharedGuid != null ? LoadedFamilyParameterKind.SharedParameter : LoadedFamilyParameterKind.FamilyParameter,
        LoadedFamilyParameterPresence.Family,
        "Double",
        formula == null ? FormulaState.None : FormulaState.Present,
        formula,
        cells.ToDictionary(c => c.Type, c => c.Value, StringComparer.Ordinal));

    [Test]
    public void Family_parameter_carries_token_dataType_and_group_and_emits_cells_as_read() {
        var result = FamilyModelParameterProjection.Project(
            [Row("Width", false, "autodesk.spec.aec:length-2.0.1", cells: [("A", "1' - 0\""), ("B", "2' - 0\"")])],
            ["A", "B"]);

        Assert.Multiple(() => {
            var p = result.Parameters["Width"];
            Assert.That(p.Shared, Is.Null);
            Assert.That(p.DataType, Is.EqualTo(DataType.Length));
            Assert.That(p.PropertiesGroup, Is.EqualTo("autodesk.parameter.group:geometry-1.0.0"));
            Assert.That(p.IsInstance, Is.False);
            Assert.That(p.Value, Is.Null, "no hoisting at capture; the reconciler canonicalizes");
            Assert.That(result.Types["A"]["Width"].Kind, Is.EqualTo(PortableValueKind.Length));
            Assert.That(result.Types["A"]["Width"].Number, Is.EqualTo(1.0).Within(1e-9));
            Assert.That(result.Types["B"]["Width"].Number, Is.EqualTo(2.0).Within(1e-9));
            Assert.That(result.Unmodeled, Is.Empty);
        });
    }

    [Test]
    public void Shared_parameter_owns_its_dataType_so_the_slot_stays_empty() {
        var result = FamilyModelParameterProjection.Project(
            [Row("PE_P_LoadCalc_DFU", false, "autodesk.spec:spec.number-2.0.0", "11111111-2222-3333-4444-555555555555", cells: [("A", "2")])],
            ["A"]);

        Assert.Multiple(() => {
            Assert.That(result.Parameters["PE_P_LoadCalc_DFU"].Shared, Is.True);
            Assert.That(result.Parameters["PE_P_LoadCalc_DFU"].DataType, Is.Null);
            Assert.That(result.Parameters["PE_P_LoadCalc_DFU"].PropertiesGroup, Is.EqualTo("autodesk.parameter.group:geometry-1.0.0"));
            Assert.That(result.Types["A"]["PE_P_LoadCalc_DFU"].Kind, Is.EqualTo(PortableValueKind.Integer));
        });
    }

    [Test]
    public void Formula_parameter_emits_no_cells() {
        var result = FamilyModelParameterProjection.Project(
            [Row("CalcWidth", false, "autodesk.spec.aec:length-2.0.1", formula: "Width / 2", cells: [("A", "0' - 6\"")])],
            ["A"]);

        Assert.Multiple(() => {
            Assert.That(result.Parameters["CalcWidth"].Formula, Is.EqualTo("Width / 2"));
            Assert.That(result.Types["A"], Is.Empty);
        });
    }

    [Test]
    public void Angle_display_string_becomes_the_portable_degree_literal_and_yesno_stays() {
        var result = FamilyModelParameterProjection.Project([
                Row("_conn angle", false, "autodesk.spec.aec:angle-2.0.0", cells: [("A", "90.00°")]),
                Row("_drain visible", false, "autodesk.spec:spec.bool-1.0.0", cells: [("A", "Yes")])
            ],
            ["A"]);

        Assert.Multiple(() => {
            Assert.That(result.Types["A"]["_conn angle"].Text, Is.EqualTo("90deg"));
            Assert.That(result.Types["A"]["_conn angle"].Kind, Is.EqualTo(PortableValueKind.Angle));
            Assert.That(result.Types["A"]["_drain visible"].Kind, Is.EqualTo(PortableValueKind.YesNo));
        });
    }

    [Test]
    public void Built_in_and_internal_helper_parameters_are_skipped_and_unknown_spec_is_unmodeled() {
        var builtIn = Row("Family Name", false, "autodesk.spec:spec.string-2.0.0") with {
            Definition = new ParameterDefinitionDescriptor(
                new ParameterIdentity("bip:-1002001", ParameterIdentityKind.BuiltInParameter, "Family Name", -1002001, null, null), false, null, null, null, null)
        };
        var result = FamilyModelParameterProjection.Project([
                builtIn,
                Row("FF_Internal_Probe", true, "autodesk.spec.aec:length-2.0.1"),
                Row("Weird", true, "autodesk.spec.aec:not-a-spec-1.0.0")
            ],
            ["A"]);

        Assert.Multiple(() => {
            Assert.That(result.Parameters.Keys, Is.EquivalentTo(new[] { "Weird" }));
            Assert.That(result.Parameters["Weird"].DataType, Is.Null);
            Assert.That(result.Unmodeled.Single().Reason, Is.EqualTo(UnmodeledReason.KindNotInVocabulary));
            Assert.That(result.Unmodeled.Single().Path, Is.EqualTo("$.parameters.Weird.dataType"));
        });
    }
}
