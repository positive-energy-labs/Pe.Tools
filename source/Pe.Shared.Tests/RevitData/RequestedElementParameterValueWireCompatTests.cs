using Newtonsoft.Json;
using Pe.Shared.RevitData;

namespace Pe.Revit.Tests;

/// <summary>
///     Wire-compat proof for the write-surface fields appended to RequestedElementParameterValue
///     (ParameterId / RawValue / IsReadOnly): payloads produced before the fields existed must
///     still deserialize, with the new fields defaulting to null.
/// </summary>
[TestFixture]
public sealed class RequestedElementParameterValueWireCompatTests {
    private const string PreWriteSurfacePayload =
        """
        {
            "Definition": {
                "Identity": {
                    "Key": "bip:-1002501",
                    "Kind": "BuiltInParameter",
                    "Name": "Mark",
                    "BuiltInParameterId": -1002501,
                    "SharedGuid": null,
                    "ParameterElementId": null
                },
                "IsInstance": true,
                "DataTypeId": null,
                "DataTypeLabel": null,
                "GroupTypeId": null,
                "GroupTypeLabel": null
            },
            "Found": true,
            "IsBlank": false,
            "Value": "AHU-1",
            "DisplayValue": "AHU-1",
            "StorageType": "String",
            "Source": "Instance"
        }
        """;

    [Test]
    public void Old_wire_payload_without_write_surface_fields_deserializes_with_null_defaults() {
        var value = JsonConvert.DeserializeObject<RequestedElementParameterValue>(PreWriteSurfacePayload);

        Assert.That(value, Is.Not.Null);
        Assert.Multiple(() => {
            Assert.That(value!.Found, Is.True);
            Assert.That(value.Value, Is.EqualTo("AHU-1"));
            Assert.That(value.ParameterId, Is.Null);
            Assert.That(value.RawValue, Is.Null);
            Assert.That(value.IsReadOnly, Is.Null);
        });
    }

    [Test]
    public void Write_surface_fields_round_trip() {
        var value = new RequestedElementParameterValue(
            new ParameterDefinitionDescriptor(
                new ParameterIdentity(
                    "bip:-1002501",
                    ParameterIdentityKind.BuiltInParameter,
                    "Mark",
                    -1002501,
                    null,
                    null
                ),
                true,
                null,
                null,
                null,
                null
            ),
            Found: true,
            IsBlank: false,
            Value: "AHU-1",
            DisplayValue: "AHU-1",
            StorageType: RequestedParameterStorageType.String,
            Source: RequestedParameterValueSource.Instance,
            ParameterId: -1002501,
            RawValue: "AHU-1",
            IsReadOnly: false
        );

        var roundTripped = JsonConvert.DeserializeObject<RequestedElementParameterValue>(
            JsonConvert.SerializeObject(value));

        Assert.That(roundTripped, Is.Not.Null);
        Assert.Multiple(() => {
            Assert.That(roundTripped!.ParameterId, Is.EqualTo(-1002501));
            Assert.That(roundTripped.RawValue, Is.EqualTo("AHU-1"));
            Assert.That(roundTripped.IsReadOnly, Is.False);
        });
    }
}
