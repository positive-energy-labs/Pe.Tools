using Newtonsoft.Json;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     Wire-compat proof for the Family Types editor fields appended in Wave 1B: identity, the
///     formula-dependency graph, and element associations on snapshot parameters, plus DryRun on the
///     apply request. Pre-extension payloads must still deserialize (new fields default to null), and
///     populated fields must round-trip. The TS wave mirrors these record shapes.
/// </summary>
[TestFixture]
public sealed class FamilyEditorSnapshotWireCompatTests {
    private const string PreExtensionParameterPayload =
        """
        {
            "Name": "Width",
            "IsInstance": false,
            "IsReadOnly": false,
            "IsDeterminedByFormula": false,
            "IsShared": false,
            "Guid": null,
            "StorageType": "Double",
            "DataType": "autodesk.spec.aec:length-2.0.0",
            "Group": "Dimensions",
            "Formula": null,
            "ValuesPerType": { "Default": "1'-0\"" }
        }
        """;

    [Test]
    public void Old_parameter_payload_without_extension_fields_deserializes_with_null_defaults() {
        var value = JsonConvert.DeserializeObject<FamilyEditorParameterSnapshot>(PreExtensionParameterPayload);

        Assert.That(value, Is.Not.Null);
        Assert.Multiple(() => {
            Assert.That(value!.Name, Is.EqualTo("Width"));
            Assert.That(value.Identity, Is.Null);
            Assert.That(value.DependsOn, Is.Null);
            Assert.That(value.Dependents, Is.Null);
            Assert.That(value.Associations, Is.Null);
        });
    }

    [Test]
    public void Extension_fields_round_trip() {
        var value = new FamilyEditorParameterSnapshot(
            "Area",
            IsInstance: false,
            IsReadOnly: false,
            IsDeterminedByFormula: true,
            IsShared: false,
            Guid: null,
            StorageType: "Double",
            DataType: "autodesk.spec.aec:area-2.0.0",
            Group: "Dimensions",
            Formula: "Width * Height",
            ValuesPerType: new Dictionary<string, string> { ["Default"] = "1 SF" },
            Identity: new ParameterIdentity(
                "name:area",
                ParameterIdentityKind.NameFallback,
                "Area",
                null,
                null,
                null
            ),
            DependsOn: new[] { "Width", "Height" },
            Dependents: new[] { "Volume" },
            Associations: new FamilyParameterAssociationInfo(
                new[] { "Width Label [ID:123]" },
                new[] { "Array 1 [ID:456]" },
                new[] { new FamilyNestedAssociation("Nested Panel [ID:789]", "789", "Depth") }
            )
        );

        var roundTripped = JsonConvert.DeserializeObject<FamilyEditorParameterSnapshot>(
            JsonConvert.SerializeObject(value));

        Assert.That(roundTripped, Is.Not.Null);
        Assert.Multiple(() => {
            Assert.That(roundTripped!.Identity!.Name, Is.EqualTo("Area"));
            Assert.That(roundTripped.DependsOn, Is.EquivalentTo(new[] { "Width", "Height" }));
            Assert.That(roundTripped.Dependents, Is.EquivalentTo(new[] { "Volume" }));
            Assert.That(roundTripped.Associations!.Dimensions, Is.EquivalentTo(new[] { "Width Label [ID:123]" }));
            Assert.That(roundTripped.Associations.Arrays, Is.EquivalentTo(new[] { "Array 1 [ID:456]" }));
            Assert.That(roundTripped.Associations.Nested, Has.Count.EqualTo(1));
            Assert.That(roundTripped.Associations.Nested[0].ParamName, Is.EqualTo("Depth"));
        });
    }

    [Test]
    public void Apply_request_dry_run_defaults_false_and_round_trips() {
        var withoutDryRun = JsonConvert.DeserializeObject<FamilyEditorApplyRequest>(
            """{ "Edits": [] }""");
        Assert.That(withoutDryRun, Is.Not.Null);
        Assert.That(withoutDryRun!.DryRun, Is.False);

        var request = new FamilyEditorApplyRequest(
            new[] { new FamilyEditorApplyEdit("Width", "Default", "2'-0\"", null) },
            DryRun: true
        );
        var roundTripped = JsonConvert.DeserializeObject<FamilyEditorApplyRequest>(
            JsonConvert.SerializeObject(request));

        Assert.That(roundTripped, Is.Not.Null);
        Assert.That(roundTripped!.DryRun, Is.True);
    }
}
